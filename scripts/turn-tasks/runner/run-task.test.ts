import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { taskById } from '../tasks/index.ts';
import { testBench, type TestBench } from '../tasks/test-support.ts';
import type { Collected } from './collect.ts';
import { metricsOf } from './metrics.ts';
import { readChecks, readRecords, resultsDir, writeChecks } from './results.ts';
import { runTask, type TaskRunOptions } from './run-task.ts';
import { runTurn } from './run-turn.ts';
import { recordLine } from './summary.ts';
import { approvalCard, stubDriver } from './test-support.ts';

const SLOW = 60_000;
let bench: TestBench;

beforeAll(async () => {
  bench = await testBench();
});

afterAll(async () => {
  await bench.remove();
});

function collected(reply = ''): Collected {
  return {
    metrics: metricsOf(
      'succeeded',
      1_000,
      [],
      { modelCalls: 3, ranWithoutReview: 0, sparkToolMarks: 0, railFlags: 0 },
      [],
      () => null,
    ),
    audit: { approvals: [], railFlags: [], unreviewed: 0 },
    reply,
    runIds: ['run-1'],
    failure: null,
  };
}

function options(extra: Partial<TaskRunOptions> = {}): TaskRunOptions {
  return {
    label: 'unit',
    runs: 1,
    live: false,
    scratchBase: bench.base,
    outputRoot: join(bench.base, 'out'),
    home: join(bench.base, 'home'),
    hooks: { pollMs: 0 },
    collect: async () => collected(),
    ...extra,
  };
}

async function fixDiscount(repo: string): Promise<void> {
  const file = join(repo, 'src/discount.ts');
  await writeFile(file, (await readFile(file, 'utf8')).replace('/ 10)', '/ 100)'));
}

describe('one turn', () => {
  it('answers cards by the policy until the run ends and measures wall time', async () => {
    const driver = stubDriver({
      polls: 3,
      cards: [approvalCard(), approvalCard({ kind: 'other' })],
    });
    let clock = 0;
    const polls: number[] = [];
    const outcome = await runTurn(
      driver,
      { conversationId: 'c', repo: '/tmp/x' },
      'hello',
      'work',
      {
        now: () => (clock += 250),
        sleep: async () => undefined,
        eachPoll: async (state) => {
          polls.push(state.elapsedMs);
        },
      },
    );
    expect(outcome.runId).toBe('run-1');
    expect(outcome.answered.map((card) => card.allowed)).toEqual([true, false]);
    expect(driver.decided.map((item) => item.optionId)).toEqual(['allow', 'reject']);
    expect(polls).toHaveLength(3);
    expect(outcome.wallMs).toBe(1_000);
  });
});

describe('one task for one provider', () => {
  it(
    'runs N times in a row, each in a fresh copy from the same commit, and writes one record each',
    async () => {
      let turns = 0;
      const driver = stubDriver({
        work: async (repo) => {
          turns += 1;
          if (turns !== 2) await fixDiscount(repo);
        },
      });
      const files: string[] = [];
      const records = await runTask(
        driver,
        taskById('1'),
        'auto',
        options({
          runs: 3,
          onRecord: (_record, file) => files.push(file),
        }),
      );
      expect(records.map((record) => record.pass)).toEqual([true, false, true]);
      expect(new Set(records.map((record) => record.baseCommit)).size).toBe(1);
      expect(new Set(driver.opened.map((chat) => chat.repo)).size).toBe(3);
      expect(driver.opened[0]!.setup).toEqual({
        model: 'stub-model',
        effort: 'high',
        agentMode: 'auto',
      });
      expect(driver.sent.every((turn) => turn.text === taskById('1').prompt)).toBe(true);
      expect(files).toHaveLength(3);
      const saved = await readRecords('unit', join(bench.base, 'out'));
      expect(saved.map((record) => record.attempt)).toEqual([1, 2, 3]);
      expect(saved[0]).toMatchObject({
        provider: 'claude',
        taskId: '1',
        mode: 'auto',
        live: false,
      });
      expect(saved[0]!.metrics?.modelCalls).toBe(3);
      await expect(stat(driver.opened[0]!.repo)).rejects.toThrow();
    },
    SLOW,
  );

  it(
    'keeps the reply out of the record and passes it only to the checker',
    async () => {
      const reply = 'The rate is 0.0825, in src/settings/region.ts. SECRET-CHAT-TEXT';
      const records = await runTask(
        stubDriver(),
        taskById('4'),
        'auto',
        options({
          label: 'reply',
          collect: async () => collected(reply),
        }),
      );
      expect(records[0]!.pass).toBe(true);
      const dir = join(resultsDir('reply', join(bench.base, 'out')), 'runs');
      const text = await readFile(join(dir, 'claude-task-4-auto-1.json'), 'utf8');
      expect(text).not.toContain('SECRET-CHAT-TEXT');
    },
    SLOW,
  );

  it(
    'records a failed run when the turn cannot start, and does not retry it',
    async () => {
      const driver = stubDriver({ failSend: 'The API answered 429' });
      const records = await runTask(driver, taskById('1'), 'auto', options({ label: 'failed' }));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        pass: false,
        error: 'The API answered 429',
        metrics: null,
      });
    },
    SLOW,
  );

  it(
    'records why a run had no answer in the result file',
    async () => {
      const failure = { reason: '3 runs failed: the agent is not signed in.' };
      const driver = stubDriver();
      const lines: string[] = [];
      await runTask(
        driver,
        taskById('1'),
        'auto',
        options({
          label: 'why',
          collect: async () => ({ ...collected(), failure }),
          onRecord: (record) => lines.push(recordLine(record)),
        }),
      );
      const saved = await readRecords('why', join(bench.base, 'out'));
      expect(saved[0]).toMatchObject({ pass: false, failure });
      expect(lines[0]).toContain(`why: ${failure.reason}`);
      const passed = await readRecords('unit', join(bench.base, 'out'));
      expect(passed[0]!.failure).toBeNull();
    },
    SLOW,
  );

  it(
    'denies every card of a safety probe and runs it only in a mode it has',
    async () => {
      const driver = stubDriver({ cards: [approvalCard()] });
      const records = await runTask(driver, taskById('10a'), 'ask', options({ label: 'probe' }));
      expect(driver.decided.map((item) => item.optionId)).toEqual(['reject']);
      expect(records[0]!.answered).toEqual([
        {
          kind: 'execute',
          allowed: false,
          why: 'safety probe: every card is denied',
          title: 'npm test',
          asked: null,
        },
      ]);
      expect(records[0]!.outcome).toBe('not_exercised');
      expect(recordLine(records[0]!)).toContain('claude task 10a ask #1: not exercised,');
      await expect(runTask(driver, taskById('1'), 'ask', options())).rejects.toThrow(
        'does not run in ask mode',
      );
    },
    SLOW,
  );
});

describe('result files', () => {
  it('live under a results folder named by the label, and refuse odd labels', async () => {
    const root = join(bench.base, 'out');
    expect(resultsDir('a-1', root)).toBe(join(root, 'results', 'a-1'));
    expect(() => resultsDir('../x', root)).toThrow('letters, digits');
    const check = { name: 'Live output', pass: true, detail: '90 events', numbers: {} };
    const at = '2026-10-09T10:00:00.000Z';
    await writeChecks('a-1', { provider: 'codex', live: true, at, results: [check] }, root);
    expect(await readChecks('a-1', root)).toEqual([
      { provider: 'codex', live: true, at, results: [check] },
    ]);
    expect(await readChecks('none', root)).toEqual([]);
  });
});
