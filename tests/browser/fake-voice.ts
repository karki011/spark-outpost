import type { Page } from '@playwright/test';

export interface FakeVoiceOptions {
  enabled?: boolean;
  speakAnswers?: boolean;
  mic?: 'granted' | 'denied' | 'not_determined';
  listenError?: string;
  listenDelayMs?: number;
  arch?: 'arm64' | 'x64';
  language?: string;
  model?: string;
  downloaded?: string[];
  downloadStepMs?: number;
}

export interface VoiceCall {
  op: string;
  args: unknown[];
}

export async function installFakeVoice(page: Page, options: FakeVoiceOptions = {}) {
  await page.addInitScript((settings) => {
    const none = () => () => undefined;
    const calls: { op: string; args: unknown[] }[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const changes: ((status: unknown) => void)[] = [];
    const opened: string[] = [];
    let counter = 0;
    const ids = ['parakeet-v3', 'whisper-base', 'whisper-large-v3-turbo'];
    const state = {
      enabled: settings.enabled ?? true,
      speakAnswers: settings.speakAnswers ?? false,
      shortcutMode: 'keys',
      hold: false,
      model: settings.model ?? 'whisper-base',
    };
    type Row = { state: string; progress: number | null; problem: string | null };
    const downloaded =
      settings.downloaded ?? (settings.enabled === false ? [] : [settings.model ?? 'whisper-base']);
    const models: Record<string, Row> = Object.fromEntries(
      ids.map((id) => [
        id,
        { state: downloaded.includes(id) ? 'ready' : 'missing', progress: null, problem: null },
      ]),
    );
    let downloading: { id: string; timer: number; switchAfter: boolean } | null = null;
    const status = () => ({
      supported: true,
      helper: 'ready',
      settings: {
        enabled: state.enabled,
        speakAnswers: state.speakAnswers,
        shortcutMode: state.shortcutMode,
        shortcut: 'Alt+Shift+V',
        hold: state.hold,
        model: state.model,
      },
      mic: settings.mic ?? 'granted',
      inputMonitoring: false,
      fnSetting: 'emoji',
      fnActive: false,
      shortcutFailed: false,
      model: models[state.model]!.state,
      models: Object.fromEntries(ids.map((id) => [id, { ...models[id] }])),
      arch: settings.arch ?? 'arm64',
      language: settings.language ?? 'en',
    });
    const record = (op: string, ...args: unknown[]) => calls.push({ op, args });
    const publish = () => changes.forEach((change) => change(status()));
    const download = (id: string, switchAfter: boolean) => {
      if (downloading) return;
      models[id] = { state: 'downloading', progress: 0, problem: null };
      const timer = window.setInterval(() => {
        const row = models[id]!;
        const progress = Math.min(1, Math.round(((row.progress ?? 0) + 0.25) * 100) / 100);
        if (progress < 1) {
          models[id] = { ...row, progress };
        } else {
          window.clearInterval(timer);
          downloading = null;
          models[id] = { state: 'ready', progress: null, problem: null };
          if (switchAfter) state.model = id;
        }
        publish();
      }, settings.downloadStepMs ?? 400);
      downloading = { id, timer, switchAfter };
    };
    Object.assign(window, {
      voiceCalls: calls,
      openedChats: opened,
      voiceEmit: (event: unknown) => listeners.forEach((listener) => listener(event)),
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: none },
        updates: { get: async () => null, onChange: none },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: none,
          onEscape: none,
          sparkFocused: async () => false,
          onSparkFocus: none,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: (id: string) => opened.push(id),
          setRestSize: () => undefined,
        },
        speech: {
          status: async () => status(),
          turnOn: async (model?: string) => {
            record('turnOn', ...(model ? [model] : []));
            state.enabled = true;
            if (model) state.model = model;
            if (models[state.model]!.state !== 'ready') download(state.model, false);
            publish();
            return status();
          },
          download: async (id: string) => {
            record('download', id);
            download(id, false);
            publish();
            return status();
          },
          cancelDownload: async (id: string) => {
            record('cancelDownload', id);
            if (downloading?.id === id) {
              window.clearInterval(downloading.timer);
              downloading = null;
              models[id] = { state: 'missing', progress: null, problem: null };
            }
            publish();
            return status();
          },
          remove: async (id: string) => {
            record('remove', id);
            if (id !== state.model)
              models[id] = { state: 'missing', progress: null, problem: null };
            publish();
            return status();
          },
          select: async (id: string) => {
            record('select', id);
            if (models[id]!.state === 'ready') state.model = id;
            else download(id, true);
            publish();
            return status();
          },
          turnOff: async () => {
            record('turnOff');
            state.enabled = false;
            if (downloading) {
              window.clearInterval(downloading.timer);
              models[downloading.id] = { state: 'missing', progress: null, problem: null };
              downloading = null;
            }
            publish();
            return status();
          },
          update: async (patch: Record<string, unknown>) => {
            record('update', patch);
            Object.assign(state, patch);
            publish();
            return status();
          },
          listen: async (purpose: string, hint: string) => {
            record('listen', purpose, hint);
            if (settings.listenError) return { ok: false, error: settings.listenError };
            counter += 1;
            const id = `listen-${counter}`;
            if (settings.listenDelayMs)
              await new Promise((resolve) => setTimeout(resolve, settings.listenDelayMs));
            record('resolved', id);
            return { ok: true, id };
          },
          stop: async (id: string) => record('stop', id),
          cancel: async (id: string) => {
            record('cancel', id);
            listeners.forEach((listener) => listener({ kind: 'cancelled', id }));
          },
          speak: async (text: string) => {
            record('speak', text);
            return 'spoken-1';
          },
          hush: async () => record('hush'),
          openSettings: async (pageName: string) => record('openSettings', pageName),
          onEvent: (callback: (event: unknown) => void) => {
            listeners.push(callback);
            return () => listeners.splice(listeners.indexOf(callback), 1);
          },
          onChange: (callback: (next: unknown) => void) => {
            changes.push(callback);
            return () => changes.splice(changes.indexOf(callback), 1);
          },
        },
        onOpenChat: none,
      },
    });
  }, options);
}

export const voiceCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { voiceCalls: VoiceCall[] }).voiceCalls);

export const emitVoice = (page: Page, event: unknown) =>
  page.evaluate((payload) => {
    (window as unknown as { voiceEmit: (event: unknown) => void }).voiceEmit(payload);
  }, event);

async function listens(page: Page): Promise<VoiceCall[]> {
  return (await voiceCalls(page)).filter((call) => call.op === 'listen');
}

export async function press(page: Page): Promise<{ id: string; purpose: string }> {
  const before = (await listens(page)).length;
  await emitVoice(page, { kind: 'press' });
  await page.waitForFunction(
    (count) =>
      (window as unknown as { voiceCalls: VoiceCall[] }).voiceCalls.filter(
        (call) => call.op === 'listen',
      ).length > count,
    before,
  );
  const latest = (await listens(page)).at(-1)!;
  if (latest.args[0] !== 'dictation')
    await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
  return { id: `listen-${before + 1}`, purpose: String(latest.args[0]) };
}

export async function say(page: Page, text: string): Promise<{ id: string; purpose: string }> {
  const listen = await press(page);
  await emitVoice(page, { kind: 'speech', id: listen.id });
  await emitVoice(page, { kind: 'final', id: listen.id, text, reason: 'paused' });
  return listen;
}
