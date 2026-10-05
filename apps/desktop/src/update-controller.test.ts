import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { createUpdateController, type Emit, type UpdateDriver } from './update-controller.ts';
import type { UpdatePrefs } from './update-prefs.ts';
import {
  initialStatus,
  INSTALL_STALL_TIMEOUT_MS,
  INSTALL_STALLED_MESSAGE,
  RUNS_RECHECK_MS,
} from './update-state.ts';

interface Timer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

interface Harness {
  runs: number | null;
  installs: boolean[];
  quits: number;
  saved: UpdatePrefs[];
  timers: Timer[];
  logs: string[];
  fire: (ms: number) => void;
  finishDownload: () => void;
  emit: Emit;
}

function setup(prefs: Partial<UpdatePrefs> = {}, skippedVersion: string | null = null) {
  const harness: Harness = {
    runs: 0,
    installs: [],
    quits: 0,
    saved: [],
    timers: [],
    logs: [],
    fire: (ms) => {
      const due = harness.timers.filter((timer) => timer.ms === ms && !timer.cancelled);
      harness.timers = harness.timers.filter((timer) => !due.includes(timer));
      for (const timer of due) timer.run();
    },
    finishDownload: () => undefined,
    emit: () => undefined,
  };
  const makeDriver = (emit: Emit): UpdateDriver => {
    harness.emit = emit;
    return {
      configure: () => undefined,
      check: async () => '0.2.0',
      download: () =>
        new Promise<void>((resolve) => {
          harness.finishDownload = () => {
            emit({ type: 'progress', percent: 100 });
            emit({ type: 'downloaded', version: '0.2.0' });
            resolve();
          };
        }),
      install: (relaunch) => harness.installs.push(relaunch),
    };
  };
  const full: UpdatePrefs = { channel: 'stable', autoDownload: true, ...prefs };
  const controller = createUpdateController(makeDriver, {
    initial: initialStatus({
      currentVersion: '0.1.0',
      channel: full.channel,
      autoDownload: full.autoDownload,
      offReason: null,
      feedUrl: null,
    }),
    prefs: full,
    savePrefs: async (next) => {
      harness.saved.push(next);
    },
    skippedVersion,
    activeRuns: async () => harness.runs,
    onChange: () => undefined,
    quit: () => {
      harness.quits += 1;
    },
    log: (line) => {
      harness.logs.push(line);
    },
    later: (run, ms) => {
      const timer: Timer = { run, ms, cancelled: false };
      harness.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { controller, harness };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function phase(status: UpdateStatus) {
  return status.phase;
}

async function readyToInstall() {
  const made = setup();
  const checking = made.controller.check();
  await settle();
  made.harness.finishDownload();
  await checking;
  return made;
}

function stallLogs(harness: Harness): string[] {
  return harness.logs.filter((line) => line.includes('stalled'));
}

describe('update controller', () => {
  it('downloads in the background and installs on click with no active runs', async () => {
    const { controller, harness } = setup();
    const checking = controller.check();
    await settle();
    expect(phase(controller.status())).toBe('downloading');
    harness.finishDownload();
    await checking;
    expect(phase(controller.status())).toBe('ready');
    expect(harness.installs).toEqual([]);

    expect(await controller.requestInstall()).toEqual({ status: 'installing' });
    expect(harness.installs).toEqual([true]);
    expect(phase(controller.status())).toBe('installing');
  });

  it('with automatic downloads off, a click downloads and then installs', async () => {
    const { controller, harness } = setup({ autoDownload: false });
    await controller.check();
    expect(phase(controller.status())).toBe('available');

    expect(await controller.requestInstall()).toEqual({ status: 'downloading' });
    await settle();
    expect(controller.status()).toMatchObject({ phase: 'downloading', installRequested: true });
    harness.finishDownload();
    await settle();
    expect(harness.installs).toEqual([true]);
  });

  it('waits for running work and installs once it finishes', async () => {
    const { controller, harness } = setup();
    const checking = controller.check();
    await settle();
    harness.finishDownload();
    await checking;
    harness.runs = 2;

    expect(await controller.requestInstall()).toEqual({
      status: 'waiting',
      reason: 'Spark will update when your work finishes.',
    });
    expect(controller.status()).toMatchObject({ phase: 'ready', waitingForRuns: true });
    expect(harness.installs).toEqual([]);

    harness.runs = 0;
    harness.fire(RUNS_RECHECK_MS);
    await settle();
    expect(harness.installs).toEqual([true]);
  });

  it('installs on quit without relaunching, or just quits while work is running', async () => {
    const busy = setup();
    const checking = busy.controller.check();
    await settle();
    busy.harness.finishDownload();
    await checking;
    busy.harness.runs = 1;
    expect(busy.controller.takeOverQuit()).toBe(true);
    await settle();
    expect(busy.harness.installs).toEqual([]);
    expect(busy.harness.quits).toBe(1);

    const idle = setup();
    const idleCheck = idle.controller.check();
    await settle();
    idle.harness.finishDownload();
    await idleCheck;
    expect(idle.controller.takeOverQuit()).toBe(true);
    await settle();
    expect(idle.harness.installs).toEqual([false]);
    idle.harness.emit({ type: 'error', message: 'Code signature did not pass validation' });
    expect(idle.harness.quits).toBe(1);
    expect(idle.controller.takeOverQuit()).toBe(false);
  });

  it('returns to ready with a reason and a log line when the install stalls', async () => {
    const { controller, harness } = await readyToInstall();
    await controller.requestInstall();
    expect(phase(controller.status())).toBe('installing');

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(controller.status()).toMatchObject({
      phase: 'ready',
      installRequested: false,
      error: INSTALL_STALLED_MESSAGE,
    });
    expect(stallLogs(harness)).toEqual([
      'Update install stalled: the app was still running 90 s after the install started. Back to ready.',
    ]);
  });

  it('installs again when Restart to update is clicked after a stall', async () => {
    const { controller, harness } = await readyToInstall();
    await controller.requestInstall();
    harness.fire(INSTALL_STALL_TIMEOUT_MS);

    expect(await controller.requestInstall()).toEqual({ status: 'installing' });
    expect(harness.installs).toEqual([true, true]);
    expect(controller.status()).toMatchObject({ phase: 'installing', error: null });

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(controller.status()).toMatchObject({ phase: 'ready', error: INSTALL_STALLED_MESSAGE });
    expect(stallLogs(harness)).toHaveLength(2);
  });

  it('keeps a failed install on its own error instead of the stall message', async () => {
    const { controller, harness } = await readyToInstall();
    await controller.requestInstall();
    harness.emit({ type: 'error', message: 'Code signature did not pass validation' });

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(controller.status()).toMatchObject({
      phase: 'ready',
      error: 'Code signature did not pass validation',
    });
    expect(stallLogs(harness)).toEqual([]);
  });

  it('does not fall back once the app is quitting', async () => {
    const { controller, harness } = await readyToInstall();
    await controller.requestInstall();
    expect(controller.takeOverQuit()).toBe(false);

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(phase(controller.status())).toBe('installing');
    expect(stallLogs(harness)).toEqual([]);
  });

  it('does not watch for a stall when the install starts from quitting', async () => {
    const { controller, harness } = await readyToInstall();
    expect(controller.takeOverQuit()).toBe(true);
    await settle();
    expect(harness.installs).toEqual([false]);

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(phase(controller.status())).toBe('installing');
    expect(harness.quits).toBe(0);
    expect(stallLogs(harness)).toEqual([]);
  });

  it('cancels the stall watch when disposed', async () => {
    const { controller, harness } = await readyToInstall();
    await controller.requestInstall();
    controller.dispose();

    harness.fire(INSTALL_STALL_TIMEOUT_MS);
    expect(phase(controller.status())).toBe('installing');
    expect(stallLogs(harness)).toEqual([]);
  });

  it('does not take over quitting when nothing is staged', () => {
    const { controller } = setup();
    expect(controller.takeOverQuit()).toBe(false);
  });

  it('skips a version whose migration failed', async () => {
    const { controller } = setup({}, '0.2.0');
    await controller.check();
    expect(controller.status()).toMatchObject({ phase: 'idle', skippedVersion: '0.2.0' });
  });

  it('saves the channel and automatic download choices', async () => {
    const { controller, harness } = setup({ autoDownload: false });
    await controller.check();
    await controller.setAutoDownload(true);
    expect(phase(controller.status())).toBe('downloading');
    await controller.setChannel('beta');
    expect(harness.saved).toEqual([
      { channel: 'stable', autoDownload: true },
      { channel: 'beta', autoDownload: true },
    ]);
  });
});
