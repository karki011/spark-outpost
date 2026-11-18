import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { createAppLock, type Recovery } from './app-lock.ts';
import { appLockGate } from './app-lock-gate.ts';
import { watchesIdle, type AppLockStatus } from './app-lock-state.ts';
import {
  appLockFile,
  codeMatches,
  hashCode,
  readAppLockRecord,
  saveAppLockRecord,
} from './app-lock-store.ts';
import { IPC } from './ipc-channels.ts';
import { appLayout } from './layout.ts';
import { ownerAuth } from './owner-auth.ts';

const IDLE_POLL_MS = 10_000;
const TOUCH_ID_REASON = 'unlock Spark Outpost';

export interface AppLockHostOptions {
  userData: string;
  trusted: (event: IpcMainInvokeEvent) => boolean;
  log: (line: string) => void;
}

export interface AppLockHost {
  dispose(): void;
}

const RECOVERY_REASON = 'reset the Spark Outpost privacy code';

const CHANNELS = [
  IPC.lockRecover,
  IPC.lockStatus,
  IPC.lockNow,
  IPC.lockUnlockTouchId,
  IPC.lockUnlockCode,
  IPC.lockSetCode,
  IPC.lockSet,
];

function touchIdAvailable(): boolean {
  return process.platform === 'darwin' && systemPreferences.canPromptTouchID();
}

function broadcast(status: AppLockStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.lockChanged, status);
  }
}

export function startAppLock(options: AppLockHostOptions): AppLockHost {
  const file = appLockFile(options.userData);
  const layout = appLayout({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const owner = ownerAuth(layout.noActivateAddon, options.log);
  let poll: NodeJS.Timeout | null = null;

  const watchIdle = (on: boolean) => {
    if (on === (poll !== null)) return;
    if (poll) clearInterval(poll);
    poll = on
      ? setInterval(() => lock.idleFor(powerMonitor.getSystemIdleTime()), IDLE_POLL_MS)
      : null;
    poll?.unref();
  };

  const publish = (status: AppLockStatus) => {
    appLockGate.publish({
      locked: status.locked,
      available: status.enabled && status.hasCode,
      hideNotifications: status.hideNotifications,
    });
    watchIdle(watchesIdle(status));
  };

  const lock = createAppLock(readAppLockRecord(file), {
    save: (record) => saveAppLockRecord(file, record),
    hash: hashCode,
    matches: codeMatches,
    touchIdAvailable,
    promptTouchId: () => systemPreferences.promptTouchID(TOUCH_ID_REASON),
    ownerAuthAvailable: owner.available,
    authenticateOwner: () => owner.authenticate(RECOVERY_REASON),
    now: Date.now,
    later: (run, ms) => {
      const timer = setTimeout(run, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
    changed: (status) => {
      publish(status);
      broadcast(status);
    },
    log: options.log,
  });
  publish(lock.status());
  appLockGate.serve(lock.lockNow);

  const handle = <T>(channel: string, refused: T, run: (value: unknown) => T | Promise<T>) => {
    ipcMain.handle(channel, (event, value: unknown) =>
      options.trusted(event) ? run(value) : refused,
    );
  };
  handle(IPC.lockStatus, null, () => lock.status());
  handle(IPC.lockNow, undefined, () => lock.lockNow());
  handle(IPC.lockUnlockTouchId, false, () => lock.unlockWithTouchId());
  handle(IPC.lockUnlockCode, { ok: false, retryAt: null }, (code) => lock.unlockWithCode(code));
  handle(IPC.lockSetCode, { ok: false }, (input) => lock.setCode(input));
  handle(IPC.lockSet, null, (patch) => lock.set(patch));
  handle<Recovery>(IPC.lockRecover, { ok: false, reason: 'failed' }, () => lock.recover());

  const onInitiallyLocked = (event: IpcMainEvent) => {
    event.returnValue = options.trusted(event) && lock.status().locked;
  };
  ipcMain.on(IPC.lockInitiallyLocked, onInitiallyLocked);

  powerMonitor.on('lock-screen', lock.lockForSleep);
  powerMonitor.on('suspend', lock.lockForSleep);

  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      powerMonitor.off('lock-screen', lock.lockForSleep);
      powerMonitor.off('suspend', lock.lockForSleep);
      ipcMain.off(IPC.lockInitiallyLocked, onInitiallyLocked);
      watchIdle(false);
      lock.dispose();
      appLockGate.serve(null);
    },
  };
}
