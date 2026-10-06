import { describe, expect, it } from 'vitest';
import type { CheckBody, CheckResult } from '@spark-outpost/contracts';
import {
  OUT_OF_SCOPE_RULE,
  changeFailureText,
  checkLines,
  checksFailing,
  fixAlreadyTried,
  startsCheckFix,
  unrelatedCheckNotes,
} from './check-results.ts';
import { UNRELATED_FAILURES_RULE, publishTurnPrompt } from './context.ts';
import type { Session } from './session.ts';

const result = (overrides: Partial<CheckResult>): CheckResult => ({
  command: 'pnpm run test',
  kind: 'test',
  outcome: 'failed',
  exitCode: 1,
  durationMs: 10,
  outputTail: 'boom',
  truncated: false,
  note: null,
  approvalId: null,
  ...overrides,
});

const body = (results: CheckResult[], overrides: Partial<CheckBody> = {}): CheckBody => ({
  runId: '00000000-0000-4000-8000-000000000001',
  name: 'Bolt',
  copy: null,
  round: 1,
  status: results.some((entry) => entry.cause === 'change') ? 'failed' : 'skipped',
  results,
  ...overrides,
});

const OLD = ['task dates:test', 'task node-compat:test'];
const preexisting = result({ cause: 'baseline', failures: OLD, blamed: [] });
const unsure = result({ command: 'pnpm run lint', kind: 'lint', cause: 'unknown', failures: OLD });
const mine = result({
  cause: 'change',
  failures: ['test libs/a/src/a.test.ts', ...OLD],
  blamed: ['test libs/a/src/a.test.ts'],
});

function session(earlier: CheckBody[] = [], checkBodies: CheckBody[] = []): Session {
  const db = { query: async () => ({ rows: earlier.map((entry) => ({ body: entry })) }) };
  return {
    input: { identity: { threadId: 'c1' } },
    lease: { runId: 'r2' },
    deps: { db },
    checkBodies,
  } as unknown as Session;
}

describe('what a Critic or verifier is told about the checks', () => {
  it('names failures the change did not cause and puts them out of scope', () => {
    const lines = checkLines(body([preexisting, unsure]));
    expect(lines).toEqual([
      '- `pnpm run test` fails the same way before this change (not caused by it): task dates:test, task node-compat:test',
      '- `pnpm run lint` fails, and nothing ties it to this change (not counted against it): task dates:test, task node-compat:test',
      '',
      OUT_OF_SCOPE_RULE,
    ]);
    expect(lines.join('\n')).not.toContain('```');
  });

  it('adds no scope rule when every check passed or the change caused the failure', () => {
    expect(checkLines(body([result({ outcome: 'passed', exitCode: 0 })]))).toEqual([
      '- `pnpm run test` passed',
    ]);
    expect(checkLines(body([mine])).join('\n')).not.toContain(OUT_OF_SCOPE_RULE);
  });
});

describe('the fix prompt', () => {
  it('says which failures are tied to the change and which to leave alone', () => {
    const text = changeFailureText(body([mine]));
    expect(text).toContain('Spark ties these to your change: test libs/a/src/a.test.ts.');
    expect(text).toContain('leave them alone: task dates:test, task node-compat:test.');
  });

  it('is sent once for one failing set in a turn, and marks the unchanged set as left', async () => {
    const s = session();
    const first = body([mine]);
    expect(await fixAlreadyTried(s, first)).toBe(false);
    expect(startsCheckFix(s, first)).toBe(true);
    expect(startsCheckFix(s, first)).toBe(false);
    const again = body([mine], { round: 2 });
    expect(await fixAlreadyTried(s, again)).toBe(true);
    expect(startsCheckFix(s, { ...again, leftForUser: true })).toBe(false);
  });

  it('is not sent again in the next turn for the failing set the last turn ended with', async () => {
    const s = session([body([mine])]);
    expect(await fixAlreadyTried(s, body([mine]))).toBe(true);
    const other = result({ cause: 'change', failures: ['test libs/b/src/b.test.ts'] });
    expect(await fixAlreadyTried(s, body([other]))).toBe(false);
  });

  it('never starts for failures the change did not cause', async () => {
    const s = session();
    const calm = body([preexisting, unsure]);
    expect(await fixAlreadyTried(s, calm)).toBe(false);
    expect(startsCheckFix(s, calm)).toBe(false);
    expect(checksFailing(session([], [calm]))).toBe(false);
  });
});

describe('what the publish turn says about checks', () => {
  it('states unrelated failures as facts for the description, once each', () => {
    const notes = unrelatedCheckNotes(session([], [body([preexisting, unsure, mine])]));
    expect(notes.map((note) => note.text)).toEqual([
      '`pnpm run test` fails without this change as well (task dates:test, task node-compat:test); this change did not cause it.',
      '`pnpm run lint` fails (task dates:test, task node-compat:test) in files this change does not touch; Spark could not tell whether it also fails without the change.',
    ]);
  });

  it('keeps unrelated failures out of the title and the draft state', () => {
    const notes = unrelatedCheckNotes(session([], [body([preexisting])])).map((note) => note.text);
    const prompt = publishTurnPrompt({
      branch: 'spark/x',
      draft: false,
      titlePrefix: null,
      notes,
      unrelatedFailures: true,
    });
    expect(prompt).toContain(UNRELATED_FAILURES_RULE);
    expect(prompt).not.toContain('Checks failing');
    expect(prompt).not.toContain('--draft');
    expect(prompt).toContain('fails without this change as well');
  });
});
