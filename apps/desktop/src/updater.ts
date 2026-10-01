import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AppUpdater } from 'electron-updater';
import type { InstallResult, UpdateStatus } from '@spark-outpost/contracts';
import { IPC } from './ipc-channels.ts';
import { loadChannel, saveChannel, updatePrefsFile } from './update-prefs.ts';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  initialStatus,
  installDecision,
  parseChannel,
  reduceUpdate,
  updaterChannel,
  type UpdateEvent,
} from './update-state.ts';

const QUIT_HANDOFF_TIMEOUT_MS = 60_000;

export interface UpdaterOptions {
  enabled: boolean;
  version: string;
  userData: string;
  feedUrl: string | null;
  skippedVersion: string | null;
  activeRuns: () => Promise<number | null>;
  trusted: (event: IpcMainInvokeEvent) => boolean;
  broadcast: (status: UpdateStatus) => void;
  quit: () => void;
  log: (line: string) => void;
}

export interface Updater {
  status(): UpdateStatus;
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startUpdater(options: UpdaterOptions): Promise<Updater> {
  const prefs = updatePrefsFile(options.userData);
  const offReason = !options.enabled ? 'dev' : options.feedUrl ? null : 'unconfigured';
  let status = initialStatus({
    currentVersion: options.version,
    channel: await loadChannel(prefs),
    offReason,
    feedUrl: options.feedUrl,
  });
  const apply = (event: UpdateEvent) => {
    status = reduceUpdate(status, event);
    options.broadcast(status);
  };
  const autoUpdater = offReason ? null : await loadAutoUpdater();
  let installing = false;
  let quitting = false;
  let timers: NodeJS.Timeout[] = [];

  const configure = (updater: AppUpdater) => {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.channel = updaterChannel(status.channel);
    updater.allowDowngrade = false;
    updater.allowPrerelease = status.channel === 'beta';
  };

  const check = async () => {
    if (!autoUpdater || status.phase === 'checking' || status.phase === 'downloading') return;
    apply({ type: 'checking', at: new Date() });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        apply({ type: 'not-available' });
        return;
      }
      const version = result.updateInfo.version;
      if (status.phase === 'ready' && status.availableVersion === version) return;
      if (version === options.skippedVersion) {
        apply({ type: 'skipped', version });
        return;
      }
      apply({ type: 'available', version });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      apply({ type: 'error', message: errorText(error) });
    }
  };

  if (autoUpdater) {
    configure(autoUpdater);
    autoUpdater.logger = {
      info: (message?: unknown) => options.log(String(message)),
      warn: (message?: unknown) => options.log(String(message)),
      error: (message?: unknown) => options.log(String(message)),
      debug: () => undefined,
    };
    autoUpdater.on('download-progress', (progress) =>
      apply({ type: 'progress', percent: progress.percent }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      apply({ type: 'downloaded', version: info.version }),
    );
    autoUpdater.on('error', (error) => {
      apply({ type: 'error', message: errorText(error) });
      installing = false;
      if (quitting) options.quit();
    });
    timers = [
      setTimeout(() => void check(), FIRST_CHECK_DELAY_MS),
      setInterval(() => void check(), CHECK_INTERVAL_MS),
    ];
  }

  const install = async (relaunch: boolean): Promise<InstallResult> => {
    const decision = installDecision(status, await options.activeRuns());
    if (!decision.started || !autoUpdater) return decision;
    installing = true;
    autoUpdater.autoRunAppAfterInstall = relaunch;
    options.log(
      `Installing ${status.availableVersion}${relaunch ? ' and restarting' : ' on quit'}.`,
    );
    autoUpdater.quitAndInstall();
    return decision;
  };

  const guard =
    <T, A extends unknown[]>(handler: (...args: A) => Promise<T> | T, fallback: T) =>
    (event: IpcMainInvokeEvent, ...args: A) =>
      options.trusted(event) ? handler(...args) : fallback;

  ipcMain.handle(
    IPC.updatesGet,
    guard(() => status, null),
  );
  ipcMain.handle(
    IPC.updatesCheck,
    guard(async () => {
      await check();
      return status;
    }, null),
  );
  ipcMain.handle(
    IPC.updatesSetChannel,
    guard(async (value: unknown) => {
      const channel = parseChannel(value);
      if (!channel || channel === status.channel) return status;
      await saveChannel(prefs, channel);
      apply({ type: 'channel', channel });
      if (autoUpdater) {
        configure(autoUpdater);
        void check();
      }
      return status;
    }, null),
  );
  ipcMain.handle(
    IPC.updatesInstall,
    guard(() => install(true), { started: false, reason: 'Not allowed.' } as InstallResult),
  );

  return {
    status: () => status,
    takeOverQuit() {
      if (quitting || installing || status.phase !== 'ready' || !autoUpdater) return false;
      quitting = true;
      void install(false).then((result) => {
        if (!result.started) {
          options.quit();
          return;
        }
        setTimeout(options.quit, QUIT_HANDOFF_TIMEOUT_MS).unref();
      });
      return true;
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      for (const channel of [
        IPC.updatesGet,
        IPC.updatesCheck,
        IPC.updatesSetChannel,
        IPC.updatesInstall,
      ]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
