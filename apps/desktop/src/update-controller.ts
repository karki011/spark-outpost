import type { InstallResult, UpdateChannel, UpdateStatus } from '@spark-outpost/contracts';
import type { UpdatePrefs } from './update-prefs.ts';
import {
  INSTALL_STALL_TIMEOUT_MS,
  INSTALL_STALLED_MESSAGE,
  installDecision,
  updateErrorMessage,
  reduceUpdate,
  RUNS_RECHECK_MS,
  updaterChannel,
  type UpdateEvent,
} from './update-state.ts';

const QUIT_HANDOFF_TIMEOUT_MS = 60_000;

export interface DriverSettings {
  channel: 'latest' | 'beta';
  allowPrerelease: boolean;
}

export interface UpdateDriver {
  configure(settings: DriverSettings): void;
  check(): Promise<string | null>;
  download(): Promise<void>;
  install(relaunch: boolean): void;
}

export type Emit = (event: UpdateEvent) => void;

export interface ControllerOptions {
  initial: UpdateStatus;
  prefs: UpdatePrefs;
  savePrefs: (prefs: UpdatePrefs) => Promise<void>;
  skippedVersion: string | null;
  activeRuns: () => Promise<number | null>;
  onChange: (status: UpdateStatus) => void;
  quit: () => void;
  log: (line: string) => void;
  later?: (run: () => void, ms: number) => () => void;
}

export interface UpdateController {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  requestInstall(): Promise<InstallResult>;
  setChannel(channel: UpdateChannel): Promise<UpdateStatus>;
  setAutoDownload(on: boolean): Promise<UpdateStatus>;
  takeOverQuit(): boolean;
  dispose(): void;
}

function errorText(error: unknown): string {
  return updateErrorMessage(error instanceof Error ? error.message : String(error));
}

function defaultLater(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
}

function driverSettings(channel: UpdateChannel): DriverSettings {
  return { channel: updaterChannel(channel), allowPrerelease: channel === 'beta' };
}

export function createUpdateController(
  makeDriver: (emit: Emit) => UpdateDriver | null,
  options: ControllerOptions,
): UpdateController {
  const later = options.later ?? defaultLater;
  let status = options.initial;
  let prefs = options.prefs;
  let quitting = false;
  let cancelRecheck: (() => void) | null = null;
  let cancelStallWatch: (() => void) | null = null;

  const stopStallWatch = () => {
    cancelStallWatch?.();
    cancelStallWatch = null;
  };

  const apply: Emit = (event) => {
    const before = status;
    status = reduceUpdate(status, event);
    if (status.phase !== before.phase) {
      const version = status.availableVersion ? ` ${status.availableVersion}` : '';
      options.log(`Update ${status.phase}${version}.`);
    }
    options.onChange(status);
    if (event.type === 'downloaded' && status.installRequested) void tryInstall(true);
    if (event.type === 'error' && quitting) options.quit();
  };

  const driver = makeDriver(apply);
  driver?.configure(driverSettings(prefs.channel));

  const download = async () => {
    if (!driver || !status.availableVersion) return;
    apply({ type: 'download-started', version: status.availableVersion });
    try {
      await driver.download();
    } catch (error) {
      apply({ type: 'error', message: errorText(error) });
    }
  };

  const reportStall = () => {
    cancelStallWatch = null;
    if (quitting || status.phase !== 'installing') return;
    const seconds = INSTALL_STALL_TIMEOUT_MS / 1000;
    options.log(
      `Update install stalled: the app was still running ${seconds} s after the install started. Back to ready.`,
    );
    apply({ type: 'error', message: INSTALL_STALLED_MESSAGE });
  };

  const tryInstall = async (relaunch: boolean): Promise<InstallResult> => {
    cancelRecheck?.();
    cancelRecheck = null;
    const decision = installDecision(status, await options.activeRuns());
    if (decision.status === 'waiting' && !quitting) {
      apply({ type: 'waiting' });
      cancelRecheck = later(() => void tryInstall(relaunch), RUNS_RECHECK_MS);
    }
    if (decision.status !== 'installing' || !driver) return decision;
    stopStallWatch();
    apply({ type: 'installing' });
    driver.install(relaunch);
    if (!quitting) cancelStallWatch = later(reportStall, INSTALL_STALL_TIMEOUT_MS);
    return decision;
  };

  const check = async () => {
    if (!driver || status.phase === 'checking' || status.phase === 'downloading') return status;
    if (status.phase === 'installing') return status;
    apply({ type: 'checking', at: new Date() });
    try {
      const version = await driver.check();
      if (!version) {
        apply({ type: 'not-available' });
        return status;
      }
      if (status.phase === 'ready' && status.availableVersion === version) return status;
      if (version === options.skippedVersion) {
        apply({ type: 'skipped', version });
        return status;
      }
      apply({ type: 'available', version });
      if (prefs.autoDownload || status.installRequested) await download();
    } catch (error) {
      apply({ type: 'error', message: errorText(error) });
    }
    return status;
  };

  const updatePrefs = async (next: UpdatePrefs) => {
    prefs = next;
    await options.savePrefs(next);
  };

  return {
    status: () => status,
    check,
    async requestInstall() {
      if (status.phase === 'ready') return tryInstall(true);
      if (status.phase === 'available' || status.phase === 'downloading') {
        apply({ type: 'install-requested' });
        if (status.phase === 'available') void download();
        return { status: 'downloading' };
      }
      if (status.phase === 'installing') return { status: 'installing' };
      return { status: 'unavailable', reason: 'There is no update to install.' };
    },
    async setChannel(channel) {
      if (channel === prefs.channel) return status;
      await updatePrefs({ ...prefs, channel });
      apply({ type: 'channel', channel });
      driver?.configure(driverSettings(channel));
      void check();
      return status;
    },
    async setAutoDownload(on) {
      await updatePrefs({ ...prefs, autoDownload: on });
      apply({ type: 'auto-download', on });
      if (on && status.phase === 'available') void download();
      return status;
    },
    takeOverQuit() {
      stopStallWatch();
      if (quitting || status.phase !== 'ready' || !driver) return false;
      quitting = true;
      void tryInstall(false).then((result) => {
        if (result.status !== 'installing') {
          options.quit();
          return;
        }
        later(options.quit, QUIT_HANDOFF_TIMEOUT_MS);
      });
      return true;
    },
    dispose() {
      cancelRecheck?.();
      stopStallWatch();
    },
  };
}
