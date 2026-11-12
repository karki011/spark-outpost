import { randomUUID } from 'node:crypto';
import {
  voicePurposeSchema,
  type VoiceEvent,
  type VoiceFnSetting,
  type VoiceHelperMessage,
  type VoiceListenResult,
  type VoiceMicPermission,
  type VoiceModel,
  type VoiceSettings,
  type VoiceShortcutResult,
  type VoiceStatus,
  VOICE_DEFAULT_SHORTCUT,
} from '@spark-outpost/contracts';
import { SHORTCUT_INVALID, SHORTCUT_TAKEN } from '../companion.ts';
import { isAccelerator } from '../companion-settings.ts';
import type { VoiceHelper } from './helper-process.ts';
import type { FetchModel } from './model.ts';
import { createModelStore, removeRetiredModels } from './model-store.ts';

export interface VoiceEffects {
  helper: VoiceHelper;
  helperExists(): boolean;
  settings: VoiceSettings;
  save(settings: VoiceSettings): void;
  micStatus(): VoiceMicPermission;
  askMic(): Promise<boolean>;
  modelDir: string;
  models: readonly VoiceModel[];
  vadPath: string;
  fetch: FetchModel;
  register(accelerator: string, run: () => void): boolean;
  unregister(accelerator: string): void;
  takenBy(accelerator: string): string | null;
  sendTo(owner: number, event: VoiceEvent): void;
  sendIsland(event: VoiceEvent): void;
  sendFocused(event: VoiceEvent): boolean;
  meetingRecording(): boolean;
  voiceOver(): boolean;
  language: string;
  allowFileInput: boolean;
  changed(status: VoiceStatus): void;
  log(line: string): void;
}

export type SettingsPatch = Partial<Pick<VoiceSettings, 'speakAnswers' | 'shortcutMode' | 'hold'>>;

const NOT_READY: VoiceListenResult = { ok: false, error: 'model_missing' };

const MEETING_NEEDS_HELPER = 'This build of Spark Outpost cannot record meetings.';
const MEETING_NEEDS_VOICE = 'Turn on Voice in Settings → Voice to record meetings.';
const MEETING_NEEDS_MODEL =
  'Voice is still getting its speech model. Settings → Voice shows its download.';

export function createVoice(effects: VoiceEffects) {
  const { helper } = effects;
  let settings = { ...effects.settings };
  let loaded: Promise<boolean> | null = null;
  let registered: string | null = null;
  let shortcutFailed = false;
  let fnActive = false;
  let inputMonitoring = false;
  let fnSetting: VoiceFnSetting = 'emoji';
  const listens = new Map<string, number>();
  let speaking: { id: string; owner: number } | null = null;
  let disposed = false;

  const store = createModelStore({
    dir: effects.modelDir,
    models: effects.models,
    fetch: effects.fetch,
    changed: () => publish(),
    log: effects.log,
  });

  const snapshot = (): VoiceStatus => ({
    supported: true,
    helper: effects.helperExists() ? 'ready' : 'missing',
    settings: { ...settings },
    mic: effects.micStatus(),
    inputMonitoring,
    fnSetting,
    fnActive,
    shortcutFailed,
    model: store.state(settings.model).state,
    models: store.snapshot(),
    language: effects.language,
  });
  const publish = () => effects.changed(snapshot());

  const commit = (next: VoiceSettings) => {
    settings = next;
    effects.save(next);
  };

  const refreshHelperStatus = async () => {
    if (!effects.helperExists()) return;
    try {
      const answer = await helper.ask({ op: 'status' }, (message) => message.event === 'status');
      if (answer.event !== 'status') return;
      inputMonitoring = answer.inputMonitoring;
      fnSetting = answer.fnSetting;
    } catch (error) {
      effects.log(`Voice status failed: ${(error as Error).message}`);
    }
  };

  const bindShortcut = () => {
    const wanted = settings.enabled ? settings.shortcut : null;
    if (registered === wanted) return;
    if (registered) effects.unregister(registered);
    registered = null;
    shortcutFailed = false;
    if (!wanted) return;
    if (effects.register(wanted, () => press())) registered = wanted;
    else shortcutFailed = true;
  };

  const rebind = (next: string): boolean => {
    const previous = registered;
    if (previous) effects.unregister(previous);
    registered = null;
    if (effects.register(next, () => press())) {
      registered = next;
      shortcutFailed = false;
      return true;
    }
    if (previous && effects.register(previous, () => press())) registered = previous;
    else shortcutFailed = true;
    return false;
  };

  const watchKeys = async () => {
    const want = settings.enabled && settings.shortcutMode === 'fn' && fnSetting === 'free';
    if (!want && !fnActive) return;
    if (!effects.helperExists()) return;
    const answer = await helper
      .ask({ op: 'keys', fn: want, hold: settings.hold }, (message) =>
        ['keys', 'error'].includes(message.event),
      )
      .catch(() => null);
    fnActive = want && answer?.event === 'keys';
  };

  const applyKeys = async () => {
    bindShortcut();
    await refreshHelperStatus();
    await watchKeys();
    publish();
  };

  const ensureLoaded = (): Promise<boolean> => {
    if (loaded) return loaded;
    const id = settings.model;
    const attempt = (async () => {
      if (!(await store.present(id))) return false;
      const answer = await helper
        .ask(
          {
            op: 'load',
            path: store.path(id),
            sha256: store.model(id).sha256,
            vad: effects.vadPath,
          },
          (message) => message.event === 'loaded' || message.event === 'error',
        )
        .catch(() => null);
      const ok = answer?.event === 'loaded';
      if (!ok) store.failed(id, 'The speech model could not be loaded.');
      return ok;
    })();
    loaded = attempt;
    void attempt.then((ok) => {
      if (!ok && loaded === attempt) loaded = null;
      publish();
    });
    return attempt;
  };

  const fetchModel = () => {
    if (store.downloading() !== null) return;
    void finishFetch();
  };

  const finishFetch = async () => {
    const outcome = await store.download(settings.model);
    if (outcome !== 'ready') return;
    if (settings.enabled && listens.size === 0) await ensureLoaded();
    publish();
  };

  const press = () => {
    if (!settings.enabled) return;
    const active = [...listens.keys()].at(-1);
    if (active) {
      helper.send({ op: 'stop', id: active });
      return;
    }
    hush();
    if (!effects.sendFocused({ kind: 'press' })) effects.sendIsland({ kind: 'press' });
  };

  const release = () => {
    for (const id of listens.keys()) helper.send({ op: 'stop', id });
  };

  const hush = () => {
    if (!speaking) return;
    const { id, owner } = speaking;
    speaking = null;
    helper.send({ op: 'hush' });
    effects.sendTo(owner, { kind: 'spoken', id, interrupted: true });
  };

  const route = (message: VoiceHelperMessage) => {
    if (message.event === 'fn_twice' || message.event === 'key_down') return press();
    if (message.event === 'key_up') return release();
    if (message.id === null) return;
    const id = message.id;
    if (speaking?.id === id && (message.event === 'spoken' || message.event === 'interrupted')) {
      const owner = speaking.owner;
      speaking = null;
      effects.sendTo(owner, { kind: 'spoken', id, interrupted: message.event === 'interrupted' });
      return;
    }
    const owner = listens.get(id);
    if (owner === undefined) return;
    const send = (event: VoiceEvent) => effects.sendTo(owner, event);
    switch (message.event) {
      case 'level':
        return send({ kind: 'level', id, level: message.level });
      case 'speech':
        return send({ kind: 'speech', id });
      case 'partial':
        return send({ kind: 'partial', id, text: message.text });
      case 'final':
        listens.delete(id);
        return send({ kind: 'final', id, text: message.text, reason: message.reason });
      case 'cancelled':
        listens.delete(id);
        return send({ kind: 'cancelled', id });
      case 'error':
        listens.delete(id);
        return send({ kind: 'error', id, error: message.error });
      default:
        return undefined;
    }
  };

  helper.onMessage(route);
  helper.onExit(() => {
    loaded = null;
    for (const [id, owner] of listens)
      effects.sendTo(owner, { kind: 'error', id, error: 'failed' });
    listens.clear();
    speaking = null;
    fnActive = false;
    if (!disposed && settings.enabled && settings.shortcutMode === 'fn') void applyKeys();
  });

  return {
    async status(): Promise<VoiceStatus> {
      await refreshHelperStatus();
      await store.refresh();
      return snapshot();
    },

    async start() {
      await removeRetiredModels(effects.modelDir);
      await store.refresh();
      if (!settings.enabled) return;
      await applyKeys();
      if (!(await store.present(settings.model))) fetchModel();
    },

    async turnOn(): Promise<VoiceStatus> {
      commit({ ...settings, enabled: true });
      if (effects.micStatus() !== 'granted') await effects.askMic();
      await store.refresh();
      publish();
      if (await store.present(settings.model)) await ensureLoaded();
      else fetchModel();
      await applyKeys();
      return snapshot();
    },

    download(): VoiceStatus {
      fetchModel();
      return snapshot();
    },

    cancelDownload(): VoiceStatus {
      store.cancel(settings.model);
      return snapshot();
    },

    async turnOff(): Promise<VoiceStatus> {
      commit({ ...settings, enabled: false });
      const downloading = store.downloading();
      if (downloading !== null) store.cancel(downloading);
      for (const id of listens.keys()) helper.send({ op: 'cancel', id });
      hush();
      await applyKeys();
      helper.kill();
      return snapshot();
    },

    async update(patch: SettingsPatch): Promise<VoiceStatus> {
      commit({ ...settings, ...patch });
      if (patch.speakAnswers === false) hush();
      await applyKeys();
      return snapshot();
    },

    setShortcut(accelerator: string | null): VoiceShortcutResult {
      const fail = (error: string) => ({ status: snapshot(), error });
      const next = accelerator ?? VOICE_DEFAULT_SHORTCUT;
      if (!isAccelerator(next)) return fail(SHORTCUT_INVALID);
      const owner = effects.takenBy(next);
      if (owner) return fail(`This shortcut already opens ${owner}.`);
      if (next === settings.shortcut) return { status: snapshot(), error: null };
      if (settings.enabled && !rebind(next)) {
        publish();
        return fail(SHORTCUT_TAKEN);
      }
      commit({ ...settings, shortcut: next });
      publish();
      return { status: snapshot(), error: null };
    },

    shortcut: () => (settings.enabled ? settings.shortcut : null),

    async listen(
      owner: number,
      purpose: unknown,
      hint: unknown,
      file: unknown,
    ): Promise<VoiceListenResult> {
      const parsed = voicePurposeSchema.safeParse(purpose);
      if (!settings.enabled || !parsed.success) return { ok: false, error: 'invalid' };
      if (file !== undefined && (!effects.allowFileInput || typeof file !== 'string'))
        return { ok: false, error: 'file_input_off' };
      if (effects.meetingRecording()) return { ok: false, error: 'meeting' };
      if (listens.size > 0) return { ok: false, error: 'busy' };
      if (file === undefined && effects.micStatus() !== 'granted')
        return { ok: false, error: 'mic_denied' };
      if (!(await ensureLoaded())) return NOT_READY;
      speaking = null;
      const id = randomUUID();
      listens.set(id, owner);
      helper.send(
        {
          op: 'listen',
          purpose: parsed.data,
          language: effects.language,
          hint: typeof hint === 'string' ? hint.slice(0, 600) : '',
          ...(typeof file === 'string' ? { file } : {}),
        },
        id,
      );
      return { ok: true, id };
    },

    stop(owner: number, id: unknown) {
      if (typeof id === 'string' && listens.get(id) === owner) helper.send({ op: 'stop', id });
    },

    cancel(owner: number, id: unknown) {
      if (typeof id !== 'string' || listens.get(id) !== owner) return;
      listens.delete(id);
      helper.send({ op: 'cancel', id });
      effects.sendTo(owner, { kind: 'cancelled', id });
    },

    speak(owner: number, text: unknown): string | null {
      if (!settings.enabled || !settings.speakAnswers || effects.voiceOver()) return null;
      if (typeof text !== 'string' || text.trim() === '' || listens.size > 0) return null;
      const id = randomUUID();
      speaking = { id, owner };
      helper.send({ op: 'speak', text: text.slice(0, 4_000) }, id);
      return id;
    },

    hush,
    press,

    meetingState() {
      if (!effects.helperExists()) return { available: false, reason: MEETING_NEEDS_HELPER };
      if (!settings.enabled) return { available: false, reason: MEETING_NEEDS_VOICE };
      if (store.state(settings.model).state !== 'ready') {
        return { available: false, reason: MEETING_NEEDS_MODEL };
      }
      return { available: true, reason: null };
    },

    async prepareMeeting(): Promise<string | null> {
      if (!effects.helperExists()) return MEETING_NEEDS_HELPER;
      if (!settings.enabled) return MEETING_NEEDS_VOICE;
      if (listens.size > 0) return 'Voice is listening. Start the meeting when it is done.';
      hush();
      return (await ensureLoaded()) ? null : MEETING_NEEDS_MODEL;
    },

    pressIsland() {
      if (!settings.enabled || listens.size > 0) return;
      effects.sendIsland({ kind: 'press' });
    },

    testPress(file: unknown) {
      if (!effects.allowFileInput || typeof file !== 'string' || !settings.enabled) return;
      hush();
      effects.sendIsland({ kind: 'press', file });
    },

    dispose() {
      disposed = true;
      if (registered) effects.unregister(registered);
      registered = null;
      store.dispose();
      helper.kill();
    },
  };
}
