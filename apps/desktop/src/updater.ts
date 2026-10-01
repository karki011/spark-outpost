import { existsSync } from 'node:fs';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AppUpdater } from 'electron-updater';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { IPC } from './ipc-channels.ts';
import {
  createUpdateController,
  type Emit,
  type UpdateController,
  type UpdateDriver,
} from './update-controller.ts';
import { loadPrefs, savePrefs, updatePrefsFile } from './update-prefs.ts';
import { previewDriver, previewPhase } from './update-preview.ts';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  initialStatus,
  parseChannel,
  updateErrorMessage,
} from './update-state.ts';

export interface UpdaterOptions {
  enabled: boolean;
  version: string;
  userData: string;
  feedUrl: string | null;
  skippedVersion: string | null;
  preview: string | undefined;
  activeRuns: () => Promise<number | null>;
  trusted: (event: IpcMainInvokeEvent) => boolean;
  broadcast: (status: UpdateStatus) => void;
  quit: () => void;
  log: (line: string) => void;
}

export interface Updater {
  takeOverQuit(): boolean;
  dispose(): void;
}

async function loadAutoUpdater(): Promise<AppUpdater> {
  const loaded = (await import('electron-updater')) as unknown as {
    autoUpdater?: AppUpdater;
    default?: { autoUpdater: AppUpdater };
  };
  const updater = loaded.autoUpdater ?? loaded.default?.autoUpdater;
  if (!updater) throw new Error('electron-updater did not load.');
  return updater;
}

function electronDriver(updater: AppUpdater, log: (line: string) => void, emit: Emit) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.logger = {
    info: (message?: unknown) => log(String(message)),
    warn: (message?: unknown) => log(String(message)),
    error: (message?: unknown) => log(String(message)),
    debug: () => undefined,
  };
  updater.on('download-progress', (progress) =>
    emit({ type: 'progress', percent: progress.percent }),
  );
  updater.on('update-downloaded', (info) => emit({ type: 'downloaded', version: info.version }));
  updater.on('error', (error: Error) =>
    emit({ type: 'error', message: updateErrorMessage(error.message) }),
  );
  const driver: UpdateDriver = {
    configure(settings) {
      updater.channel = settings.channel;
      updater.allowDowngrade = false;
      updater.allowPrerelease = settings.allowPrerelease;
    },
    async check() {
      const result = await updater.checkForUpdates();
      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    },
    async download() {
      await updater.downloadUpdate();
    },
    install(relaunch) {
      updater.autoRunAppAfterInstall = relaunch;
      updater.quitAndInstall();
    },
  };
  return driver;
}

function registerIpc(controller: UpdateController, trusted: UpdaterOptions['trusted']) {
  const handle = <A extends unknown[]>(
    channel: string,
    handler: (...args: A) => Promise<unknown> | unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      trusted(event) ? handler(...(args as A)) : null,
    );
  };
  handle(IPC.updatesGet, () => controller.status());
  handle(IPC.updatesCheck, () => controller.check());
  handle(IPC.updatesInstall, () => controller.requestInstall());
  handle(IPC.updatesSetChannel, (value: unknown) => {
    const channel = parseChannel(value);
    return channel ? controller.setChannel(channel) : controller.status();
  });
  handle(IPC.updatesSetAutoDownload, (on: unknown) =>
    typeof on === 'boolean' ? controller.setAutoDownload(on) : controller.status(),
  );
}

const CHANNELS = [
  IPC.updatesGet,
  IPC.updatesCheck,
  IPC.updatesInstall,
  IPC.updatesSetChannel,
  IPC.updatesSetAutoDownload,
];

export async function startUpdater(options: UpdaterOptions): Promise<Updater> {
  const prefsFile = updatePrefsFile(options.userData);
  const prefs = await loadPrefs(prefsFile, options.version);
  if (!existsSync(prefsFile)) await savePrefs(prefsFile, prefs).catch(() => undefined);
  const preview = options.enabled ? null : previewPhase(options.preview);
  const offReason = preview
    ? null
    : !options.enabled
      ? 'dev'
      : options.feedUrl
        ? null
        : 'unconfigured';
  const autoUpdater = offReason || preview ? null : await loadAutoUpdater();
  const controller = createUpdateController(
    (emit) => {
      if (preview) return previewDriver(emit, options.quit);
      return autoUpdater ? electronDriver(autoUpdater, options.log, emit) : null;
    },
    {
      initial: initialStatus({
        currentVersion: options.version,
        channel: prefs.channel,
        autoDownload: prefs.autoDownload,
        offReason,
        feedUrl: options.feedUrl,
      }),
      prefs: preview === 'available' ? { ...prefs, autoDownload: false } : prefs,
      savePrefs: (next) => savePrefs(prefsFile, next),
      skippedVersion: options.skippedVersion,
      activeRuns: options.activeRuns,
      onChange: options.broadcast,
      quit: options.quit,
      log: options.log,
    },
  );
  registerIpc(controller, options.trusted);
  const timers =
    autoUpdater || preview
      ? [
          setTimeout(() => void controller.check(), preview ? 0 : FIRST_CHECK_DELAY_MS),
          setInterval(() => void controller.check(), CHECK_INTERVAL_MS),
        ]
      : [];
  return {
    takeOverQuit: () => controller.takeOverQuit(),
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      controller.dispose();
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}
