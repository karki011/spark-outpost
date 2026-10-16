import { randomUUID } from 'node:crypto';
import {
  VOICE_WHISPER_BASE,
  voicePurposeSchema,
  type VoiceEvent,
  type VoiceFnSetting,
  type VoiceHelperMessage,
  type VoiceListenResult,
  type VoiceMicPermission,
  type VoiceModelState,
  type VoiceSettings,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import type { VoiceHelper } from './helper-process.ts';
import { downloadModel, modelPath, modelPresent, type FetchModel } from './model.ts';

export interface VoiceEffects {
  helper: VoiceHelper;
  helperExists(): boolean;
  settings: VoiceSettings;
  save(settings: VoiceSettings): void;
  micStatus(): VoiceMicPermission;
  askMic(): Promise<boolean>;
  modelDir: string;
  vadPath: string;
  fetch: FetchModel;
  register(accelerator: string, run: () => void): boolean;
  unregister(accelerator: string): void;
  sendTo(owner: number, event: VoiceEvent): void;
  sendIsland(event: VoiceEvent): void;
  voiceOver(): boolean;
  language: string;
  allowFileInput: boolean;
  changed(status: VoiceStatus): void;
  log(line: string): void;
}

export type SettingsPatch = Partial<Pick<VoiceSettings, 'speakAnswers' | 'shortcutMode' | 'hold'>>;

const NOT_READY: VoiceListenResult = { ok: false, error: 'model_missing' };

export function createVoice(effects: VoiceEffects) {
  const { helper } = effects;
  let settings = { ...effects.settings };
  let model: VoiceModelState = 'missing';
  let progress: number | null = null;
  let problem: string | null = null;
  let loaded: Promise<boolean> | null = null;
  let registered: string | null = null;
  let shortcutFailed = false;
  let fnActive = false;
  let inputMonitoring = false;
  let fnSetting: VoiceFnSetting = 'emoji';
  const listens = new Map<string, number>();
  let speaking: { id: string; owner: number } | null = null;

  const snapshot = (): VoiceStatus => ({
    supported: true,
    helper: effects.helperExists() ? 'ready' : 'missing',
    settings: { ...settings },
    mic: effects.micStatus(),
    inputMonitoring,
    fnSetting,
    fnActive,
    shortcutFailed,
    model,
    progress,
    problem,
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
    const attempt = (async () => {
      if (!(await modelPresent(effects.modelDir, VOICE_WHISPER_BASE))) {
        model = 'missing';
        return false;
      }
      const answer = await helper
        .ask(
          {
            op: 'load',
            path: modelPath(effects.modelDir, VOICE_WHISPER_BASE),
            sha256: VOICE_WHISPER_BASE.sha256,
            vad: effects.vadPath,
          },
          (message) => message.event === 'loaded' || message.event === 'error',
        )
        .catch(() => null);
      const ok = answer?.event === 'loaded';
      model = ok ? 'ready' : 'failed';
      problem = ok ? null : 'The speech model could not be loaded.';
      return ok;
    })();
    loaded = attempt;
    void attempt.then((ok) => {
      if (!ok && loaded === attempt) loaded = null;
      publish();
    });
    return attempt;
  };

  const download = async () => {
    model = 'downloading';
    progress = 0;
    problem = null;
    publish();
    try {
      await downloadModel({
        dir: effects.modelDir,
        model: VOICE_WHISPER_BASE,
        fetch: effects.fetch,
        progress: (fraction) => {
          const rounded = Math.floor(fraction * 100) / 100;
          if (rounded === progress) return;
          progress = rounded;
          publish();
        },
      });
      progress = null;
      return true;
    } catch (error) {
      model = 'failed';
      progress = null;
      problem = (error as Error).message || 'The download didn’t check out.';
      effects.log(`Voice model download failed: ${problem}`);
      publish();
      return false;
    }
  };

  const press = () => {
    if (!settings.enabled) return;
    const active = [...listens.keys()].at(-1);
    if (active) {
      helper.send({ op: 'stop', id: active });
      return;
    }
    hush();
    effects.sendIsland({ kind: 'press' });
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
    if (model === 'ready') model = 'missing';
    for (const [id, owner] of listens)
      effects.sendTo(owner, { kind: 'error', id, error: 'failed' });
    listens.clear();
    speaking = null;
    fnActive = false;
  });

  return {
    async status(): Promise<VoiceStatus> {
      await refreshHelperStatus();
      if (model !== 'downloading' && model !== 'ready')
        model = (await modelPresent(effects.modelDir, VOICE_WHISPER_BASE)) ? 'ready' : model;
      return snapshot();
    },

    async start() {
      if (!settings.enabled) return;
      await applyKeys();
    },

    async turnOn(): Promise<VoiceStatus> {
      commit({ ...settings, enabled: true });
      if (effects.micStatus() !== 'granted') await effects.askMic();
      publish();
      if (!(await modelPresent(effects.modelDir, VOICE_WHISPER_BASE)) && !(await download()))
        return snapshot();
      await ensureLoaded();
      await applyKeys();
      return snapshot();
    },

    async turnOff(): Promise<VoiceStatus> {
      commit({ ...settings, enabled: false });
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
      if (typeof id === 'string' && listens.get(id) === owner) helper.send({ op: 'cancel', id });
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

    testPress(file: unknown) {
      if (!effects.allowFileInput || typeof file !== 'string' || !settings.enabled) return;
      hush();
      effects.sendIsland({ kind: 'press', file });
    },

    dispose() {
      if (registered) effects.unregister(registered);
      registered = null;
      helper.kill();
    },
  };
}
