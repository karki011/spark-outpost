import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testBench, type TestBench } from '../tasks/test-support.ts';
import { runThenClose } from './lifecycle.ts';
import { readChecks } from './results.ts';
import { runSession, type SessionPlan } from './session.ts';
import { stubDriver } from './test-support.ts';

let bench: TestBench;

beforeAll(async () => {
  bench = await testBench();
});

afterAll(async () => {
  await bench.remove();
});

function plan(extra: Partial<SessionPlan>): SessionPlan {
  return { label: 'session', runs: 1, live: true, keep: false, tasks: [], mode: null, ...extra };
}

const failed = {
  name: 'Every call seen by the gate',
  pass: false,
  detail: '2 edit and command calls, 1 decisions',
  numbers: { calls: 2 },
};

describe('one runner session', () => {
  it('prints a failed check and writes it to the checks file of the provider', async () => {
    const lines: string[] = [];
    const root = join(bench.base, 'out');
    const io = { log: (line: string) => void lines.push(line), stopping: () => false };
    await runSession(stubDriver({}, 'codex'), plan({}), { ...io, outputRoot: root }, async () => [
      failed,
    ]);
    expect(lines[0]).toBe(`FAIL  Every call seen by the gate: ${failed.detail}`);
    expect(lines[1]).toMatch(/^Checks: .*session/);
    const saved = await readChecks('session', root);
    expect(saved).toMatchObject([{ provider: 'codex', live: true, results: [failed] }]);
  });

  it('writes no checks file when there was nothing to check', async () => {
    const root = join(bench.base, 'none');
    const io = { log: () => undefined, stopping: () => false, outputRoot: root };
    expect(await runSession(stubDriver(), plan({ label: 'none' }), io)).toEqual([]);
    expect(await readChecks('none', root)).toEqual([]);
  });

  it('shuts the instance down and reports failure when a check throws', async () => {
    const driver = stubDriver();
    const lines: string[] = [];
    const log = (line: string) => void lines.push(line);
    const code = await runThenClose({
      start: async () => driver,
      work: async (started) => {
        const io = { log, stopping: () => false, outputRoot: join(bench.base, 'thrown') };
        await runSession(started, plan({ label: 'thrown' }), io, async () =>
          Promise.reject(new Error('the rows could not be read')),
        );
      },
      log,
    });
    expect(code).toBe(1);
    expect(driver.closed).toBe(true);
    expect(lines).toEqual(['Failed: the rows could not be read']);
  });
});
