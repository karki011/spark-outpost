import { describe, expect, it } from 'vitest';
import {
  devAppBinary,
  runningInstances,
  stopOnInterrupt,
  stopTarget,
  type Instances,
} from './dev-app.ts';

const BINARY = devAppBinary('/main/.local/dev-app/Spark Outpost Dev.app');
const OURS = '/private/tmp/spark-dev-app-aaa/apps/desktop';
const OTHER = '/private/tmp/spark-dev-app-bbb/apps/desktop';

const PS = [
  `  501 ${BINARY} ${OURS}`,
  `  502 ${BINARY} /Users/a/spark/apps/desktop/dist/runtime-host.js /data/runtime 0.1.0 ${OURS}/../server`,
  `  503 ${BINARY} ${OURS}/dist/server-entry.js /x/apps/server/src/api/main.ts`,
  `  601 ${BINARY} ${OTHER} --remote-debugging-port=9334`,
  `  701 /Applications/Spark Outpost.app/Contents/MacOS/Spark Outpost`,
  `  801 /bin/zsh -c echo ${BINARY} ${OURS}`,
].join('\n');

describe('runningInstances', () => {
  it('finds this launch by its app folder among other dev app windows', () => {
    expect(runningInstances(PS, BINARY, OURS)).toEqual({ ours: [501], total: 2 });
    expect(runningInstances(PS, BINARY, OTHER)).toEqual({ ours: [601], total: 2 });
  });

  it('counts nothing when no dev app runs', () => {
    expect(runningInstances(`  701 /Applications/x\n`, BINARY, OURS)).toEqual({
      ours: [],
      total: 0,
    });
  });
});

describe('stopTarget', () => {
  it('stops this launch by pid when it is the only match', () => {
    expect(stopTarget({ ours: [501], total: 2 })).toEqual({ kind: 'pid', pid: 501 });
  });

  it('quits by bundle id only when one dev app runs at all', () => {
    expect(stopTarget({ ours: [], total: 1 })).toEqual({ kind: 'bundle' });
    expect(stopTarget({ ours: [], total: 2 })).toEqual({ kind: 'none' });
    expect(stopTarget({ ours: [501, 502], total: 2 })).toEqual({ kind: 'none' });
  });
});

function interrupt(instances: Instances, exits: boolean) {
  const steps: string[] = [];
  const deps = {
    findInstances: () => Promise.resolve(instances),
    terminate: (pid: number) => {
      steps.push(`term ${pid}`);
    },
    quitApp: () => {
      steps.push('quit');
      return Promise.resolve();
    },
    waitForExit: (timeoutMs: number) => {
      steps.push(`wait ${timeoutMs}`);
      return Promise.resolve(exits);
    },
    removeLink: () => {
      steps.push('unlink');
      return Promise.resolve();
    },
    log: (line: string) => {
      steps.push(line);
    },
  };
  return { steps, deps };
}

describe('stopOnInterrupt', () => {
  const link = '/private/tmp/spark-dev-app-aaa';

  it('terminates only this launch and removes the link after it exits', async () => {
    const { steps, deps } = interrupt({ ours: [501], total: 2 }, true);
    await stopOnInterrupt(link, deps);
    expect(steps).toEqual(['term 501', 'wait 30000', 'unlink']);
  });

  it('falls back to quitting by bundle id when one dev app runs', async () => {
    const { steps, deps } = interrupt({ ours: [], total: 1 }, true);
    await stopOnInterrupt(link, deps);
    expect(steps).toEqual(['quit', 'wait 30000', 'unlink']);
  });

  it('touches no app and keeps the link when this launch cannot be told apart', async () => {
    const { steps, deps } = interrupt({ ours: [], total: 2 }, true);
    await stopOnInterrupt(link, deps);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/still running.*other running copies.*spark-dev-app-aaa/);
  });

  it('keeps the link when the app does not exit in time', async () => {
    const { steps, deps } = interrupt({ ours: [501], total: 1 }, false);
    await stopOnInterrupt(link, deps);
    expect(steps).not.toContain('unlink');
    expect(steps.at(-1)).toMatch(/still running.*spark-dev-app-aaa/);
  });

  it('still waits when the bundle quit request fails', async () => {
    const { steps, deps } = interrupt({ ours: [], total: 1 }, true);
    deps.quitApp = () => Promise.reject(new Error('osascript failed'));
    await stopOnInterrupt(null, deps);
    expect(steps).toEqual(['wait 30000', 'unlink']);
  });
});
