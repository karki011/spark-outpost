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
import {
  nextPreviewVersion,
  previewActiveRuns,
  previewAutoDownload,
  previewDriver,
  previewMarkerFile,
  previewMode,
  takePreviewMarker,
  writePreviewMarker,
  type PreviewMode,
} from './update-preview.ts';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  initialStatus,
  isCheckFailure,
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
  installing: (relaunch: boolean) => void;
  relaunch: () => void;
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

function electronDriver(
  updater: AppUpdater,
  log: (line: string) => void,
  emit: Emit,
  installing: (relaunch: boolean) => void,
) {
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
  updater.on('error', (error: Error, detail?: string) => {
    if (isCheckFailure(detail)) return;
    emit({ type: 'error', message: updateErrorMessage(error.message) });
  });
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
      installing(relaunch);
      updater.autoRunAppAfterInstall = relaunch;
      updater.quitAndInstall();
    },
  };
  return driver;
}

function registerIpc(
  current: () => UpdateController,
  trusted: UpdaterOptions['trusted'],
  startPreview: () => UpdateStatus,
) {
  const handle = <A extends unknown[]>(
    channel: string,
    handler: (...args: A) => Promise<unknown> | unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      trusted(event) ? handler(...(args as A)) : null,
    );
  };
  handle(IPC.updatesGet, () => current().status());
  handle(IPC.updatesCheck, () => current().check());
  handle(IPC.updatesInstall, () => current().requestInstall());
  handle(IPC.updatesSetChannel, (value: unknown) => {
    const channel = parseChannel(value);
    return channel ? current().setChannel(channel) : current().status();
  });
  handle(IPC.updatesSetAutoDownload, (on: unknown) =>
    typeof on === 'boolean' ? current().setAutoDownload(on) : current().status(),
  );
  handle(IPC.updatesPreview, startPreview);
}

const CHANNELS = [
  IPC.updatesGet,
  IPC.updatesCheck,
  IPC.updatesInstall,
  IPC.updatesSetChannel,
  IPC.updatesSetAutoDownload,
  IPC.updatesPreview,
];

interface Running {
  controller: UpdateController;
  dispose(): void;
}

export async function startUpdater(options: UpdaterOptions): Promise<Updater> {
  const prefsFile = updatePrefsFile(options.userData);
  const prefs = await loadPrefs(prefsFile, options.version);
  if (!existsSync(prefsFile)) await savePrefs(prefsFile, prefs).catch(() => undefined);
  const devBuild = !options.enabled;
  const markerFile = previewMarkerFile(options.userData);
  const previewUpdatedTo = devBuild ? await takePreviewMarker(markerFile) : null;
  const startMode = devBuild && !previewUpdatedTo ? previewMode(options.preview) : null;
  const offReason = devBuild ? 'dev' : options.feedUrl ? null : 'unconfigured';
  const autoUpdater = offReason ? null : await loadAutoUpdater();
  const previewVersion = nextPreviewVersion(options.version);
  let generation = 0;

  const build = (mode: PreviewMode | null, updatedTo: string | null): Running => {
    generation += 1;
    const mine = generation;
    const isCurrent = () => mine === generation;
    const relaunch = async () => {
      if (!isCurrent()) return;
      await writePreviewMarker(markerFile, previewVersion);
      options.relaunch();
    };
    const controller = createUpdateController(
      (emit: Emit): UpdateDriver | null => {
        if (mode) {
          return previewDriver({
            mode,
            version: previewVersion,
            emit,
            relaunch,
            quit: options.quit,
          });
        }
        return autoUpdater
          ? electronDriver(autoUpdater, options.log, emit, options.installing)
          : null;
      },
      {
        initial: initialStatus({
          currentVersion: options.version,
          channel: prefs.channel,
          autoDownload: mode ? previewAutoDownload(mode) : prefs.autoDownload,
          offReason: mode ? null : offReason,
          feedUrl: options.feedUrl,
          devBuild,
          preview: mode !== null,
          previewUpdatedTo: updatedTo,
        }),
        prefs: mode ? { ...prefs, autoDownload: previewAutoDownload(mode) } : prefs,
        savePrefs: (next) => (mode ? Promise.resolve() : savePrefs(prefsFile, next)),
        skippedVersion: mode ? null : options.skippedVersion,
        activeRuns: mode ? previewActiveRuns(mode, options.activeRuns) : options.activeRuns,
        onChange: (status) => {
          if (isCurrent()) options.broadcast(status);
        },
        quit: options.quit,
        log: options.log,
      },
    );
    const live = Boolean(mode || autoUpdater);
    const timers = live
      ? [
          setTimeout(() => void controller.check(), mode ? 0 : FIRST_CHECK_DELAY_MS),
          setInterval(() => void controller.check(), CHECK_INTERVAL_MS),
        ]
      : [];
    return {
      controller,
      dispose() {
        for (const timer of timers) clearTimeout(timer);
        controller.dispose();
      },
    };
  };

  let running = build(startMode, previewUpdatedTo);
  const startPreview = () => {
    const status = running.controller.status();
    if (!devBuild || status.phase === 'installing') return status;
    running.dispose();
    running = build('flow', null);
    const fresh = running.controller.status();
    options.broadcast(fresh);
    return fresh;
  };
  registerIpc(() => running.controller, options.trusted, startPreview);
  return {
    takeOverQuit: () => running.controller.takeOverQuit(),
    dispose() {
      running.dispose();
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}
