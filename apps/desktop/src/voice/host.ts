import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  session,
  shell,
  systemPreferences,
  webContents,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  VOICE_INPUT_MONITORING_SETTINGS_URL,
  VOICE_KEYBOARD_SETTINGS_URL,
  VOICE_MICROPHONE_SETTINGS_URL,
  VOICE_SILERO,
  voiceShortcutModeSchema,
  type VoiceEvent,
  type VoiceListenResult,
  type VoiceMicPermission,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import { denyAppRecording } from './app-microphone.ts';
import { fakeVoiceHelper } from './fake-helper.ts';
import { spawnVoiceBinary, startVoiceHelper } from './helper-process.ts';
import { createVoice, type SettingsPatch } from './voice.ts';
import { loadVoiceSettings, saveVoiceSettings, voiceSettingsFile } from './voice-settings.ts';

export interface VoiceHostOptions {
  helperPath: string;
  modelsDir: string;
  userData: string;
  trusted(event: IpcMainInvokeEvent): boolean;
  island(): Electron.WebContents | null;
  log(line: string): void;
}

export interface VoiceHost {
  shortcut(): string | null;
  dispose(): void;
}

const INVOKE = [
  IPC.voiceStatus,
  IPC.voiceTurnOn,
  IPC.voiceTurnOff,
  IPC.voiceUpdate,
  IPC.voiceListen,
  IPC.voiceStop,
  IPC.voiceCancel,
  IPC.voiceSpeak,
  IPC.voiceHush,
  IPC.voiceTestPress,
  IPC.voiceOpenSettings,
];

const PRIVACY_PAGES: Record<string, string> = {
  microphone: VOICE_MICROPHONE_SETTINGS_URL,
  'input-monitoring': VOICE_INPUT_MONITORING_SETTINGS_URL,
  keyboard: VOICE_KEYBOARD_SETTINGS_URL,
};

function micStatus(): VoiceMicPermission {
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return 'granted';
  return status === 'not-determined' ? 'not_determined' : 'denied';
}

function language(): string {
  const preferred = app.getPreferredSystemLanguages()[0] ?? 'en';
  return preferred.split(/[-_]/)[0]?.toLowerCase() || 'en';
}

function patchFrom(value: unknown): SettingsPatch | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if (typeof record.speakAnswers === 'boolean') patch.speakAnswers = record.speakAnswers;
  if (typeof record.hold === 'boolean') patch.hold = record.hold;
  const mode = voiceShortcutModeSchema.safeParse(record.shortcutMode);
  if (mode.success) patch.shortcutMode = mode.data;
  return patch;
}

function broadcast(status: VoiceStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.voiceChanged, status);
  }
}

export async function startVoiceHost(options: VoiceHostOptions): Promise<VoiceHost> {
  denyAppRecording(session.defaultSession);
  const fake = !app.isPackaged && process.env.SPARK_FAKE_VOICE === '1';
  const allowFileInput = !app.isPackaged && process.env.SPARK_VOICE_FILE_INPUT === '1';
  const settingsPath = voiceSettingsFile(options.userData);
  const helper = startVoiceHelper({
    spawn: fake ? fakeVoiceHelper : spawnVoiceBinary(options.helperPath, allowFileInput),
    log: options.log,
  });
  let saving = Promise.resolve();
  const voice = createVoice({
    helper,
    helperExists: () => fake || existsSync(options.helperPath),
    settings: await loadVoiceSettings(settingsPath),
    save: (settings) => {
      saving = saving
        .then(() => saveVoiceSettings(settingsPath, settings))
        .catch((error: Error) => options.log(`Could not save Voice settings: ${error.message}`));
    },
    micStatus: fake ? () => 'granted' : micStatus,
    askMic: () => systemPreferences.askForMediaAccess('microphone'),
    modelDir: path.join(options.userData, 'voice'),
    vadPath: path.join(options.modelsDir, VOICE_SILERO.file),
    fetch: (url) => net.fetch(url, { bypassCustomProtocolHandlers: true }),
    register: (accelerator, run) => {
      try {
        return globalShortcut.register(accelerator, run);
      } catch {
        return false;
      }
    },
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    sendTo: (owner, event: VoiceEvent) => {
      const target = webContents.fromId(owner);
      if (target && !target.isDestroyed()) target.send(IPC.voiceEvent, event);
    },
    sendIsland: (event) => options.island()?.send(IPC.voiceEvent, event),
    voiceOver: () => app.accessibilitySupportEnabled,
    language: language(),
    allowFileInput,
    changed: broadcast,
    log: options.log,
  });

  const guard =
    <T>(run: (event: IpcMainInvokeEvent, ...args: unknown[]) => T, fallback: T) =>
    (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      options.trusted(event) ? run(event, ...args) : fallback;

  ipcMain.handle(
    IPC.voiceStatus,
    guard(() => voice.status(), null),
  );
  ipcMain.handle(
    IPC.voiceTurnOn,
    guard(() => voice.turnOn(), null),
  );
  ipcMain.handle(
    IPC.voiceTurnOff,
    guard(() => voice.turnOff(), null),
  );
  ipcMain.handle(
    IPC.voiceUpdate,
    guard((_event, patch) => {
      const parsed = patchFrom(patch);
      return parsed ? voice.update(parsed) : voice.status();
    }, null),
  );
  ipcMain.handle(
    IPC.voiceListen,
    guard(
      (event, purpose, hint, file) => voice.listen(event.sender.id, purpose, hint, file),
      Promise.resolve<VoiceListenResult>({ ok: false, error: 'invalid' }),
    ),
  );
  ipcMain.handle(
    IPC.voiceStop,
    guard((event, id) => voice.stop(event.sender.id, id), undefined),
  );
  ipcMain.handle(
    IPC.voiceCancel,
    guard((event, id) => voice.cancel(event.sender.id, id), undefined),
  );
  ipcMain.handle(
    IPC.voiceSpeak,
    guard((event, text) => voice.speak(event.sender.id, text), null),
  );
  ipcMain.handle(
    IPC.voiceHush,
    guard(() => voice.hush(), undefined),
  );
  ipcMain.handle(
    IPC.voiceTestPress,
    guard((_event, file) => voice.testPress(file), undefined),
  );
  ipcMain.handle(
    IPC.voiceOpenSettings,
    guard((_event, page) => {
      const url = typeof page === 'string' ? PRIVACY_PAGES[page] : undefined;
      if (url) void shell.openExternal(url);
    }, undefined),
  );

  void voice.start();

  return {
    shortcut: () => voice.shortcut(),
    dispose() {
      for (const channel of INVOKE) ipcMain.removeHandler(channel);
      voice.dispose();
    },
  };
}
