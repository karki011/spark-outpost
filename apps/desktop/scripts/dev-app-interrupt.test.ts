import { describe, expect, it } from 'vitest';
import { devAppBinary, launchedFrom, stopOnInterrupt, stopRefusal } from './dev-app.ts';

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

describe('launchedFrom', () => {
  it('finds only the dev app window launched from this app folder', () => {
    expect(launchedFrom(PS, BINARY, OURS)).toEqual([501]);
    expect(launchedFrom(PS, BINARY, OTHER)).toEqual([601]);
  });

  it('finds nothing when this launch is not running, even if another copy is', () => {
    expect(launchedFrom(`  601 ${BINARY} ${OTHER}\n`, BINARY, OURS)).toEqual([]);
  });
});

describe('stopRefusal', () => {
  it('allows a stop only for exactly one matching copy', () => {
    expect(stopRefusal([501], OURS)).toBeNull();
    expect(stopRefusal([], OURS)).toMatch(/no running copy/);
    expect(stopRefusal([501, 502], OURS)).toMatch(/2 running copies/);
  });
});

function interrupt(ours: number[], exits: boolean) {
  const steps: string[] = [];
  const deps = {
    launchDir: OURS,
    findOurs: () => Promise.resolve(ours),
    terminate: (pid: number) => {
      steps.push(`term ${pid}`);
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
    const { steps, deps } = interrupt([501], true);
    await stopOnInterrupt(link, deps);
    expect(steps).toEqual(['term 501', 'wait 30000', 'unlink']);
  });

  it('stops nothing and keeps the link when no copy matches this launch', async () => {
    const { steps, deps } = interrupt([], true);
    await stopOnInterrupt(link, deps);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/Not stopping.*no running copy.*spark-dev-app-aaa;/);
  });

  it('stops nothing when several copies match this launch', async () => {
    const { steps, deps } = interrupt([501, 502], true);
    await stopOnInterrupt(null, deps);
    expect(steps).toEqual([expect.stringMatching(/Not stopping.*2 running copies/)]);
  });

  it('stops nothing when the process list cannot be read', async () => {
    const { steps, deps } = interrupt([501], true);
    deps.findOurs = () => Promise.reject(new Error('ps failed'));
    await stopOnInterrupt(link, deps);
    expect(steps).toEqual([expect.stringMatching(/Not stopping.*spark-dev-app-aaa/)]);
  });

  it('keeps the link when the app does not exit in time', async () => {
    const { steps, deps } = interrupt([501], false);
    await stopOnInterrupt(link, deps);
    expect(steps).not.toContain('unlink');
    expect(steps.at(-1)).toMatch(/still running.*spark-dev-app-aaa/);
  });
});
