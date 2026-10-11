import type { ConversationDetail } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { tvCast } from './conversation-crew.ts';
import { member, orchestration } from './test-orchestration.ts';
import { RUN_ID, run } from './test-run.ts';
import {
  formatElapsed,
  outcomeOf,
  rowUsage,
  sortFinished,
  sortRunning,
  tvListRows,
  type TvRow,
} from './tv-list.ts';

function item(overrides: Partial<TvRow>): TvRow {
  return {
    key: 'k',
    runId: 'r',
    name: 'Builder',
    role: null,
    provider: 'claude',
    model: 'Sonnet 5 · medium',
    state: 'working',
    line: 'working',
    tokens: null,
    costUsd: null,
    costSource: null,
    toolCalls: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    ask: null,
    lead: false,
    order: 1,
    ...overrides,
  };
}

describe('Agent TV list elapsed time', () => {
  it('shows seconds, then minutes with padded seconds, then hours with padded minutes', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(-500)).toBe('0s');
    expect(formatElapsed(42_900)).toBe('42s');
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(20 * 60_000 + 5_000)).toBe('20m 05s');
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 59_000)).toBe('1h 02m');
  });
});

describe('Agent TV list order', () => {
  it('puts agents that need you first, then working, then queued', () => {
    const rows = sortRunning([
      item({ key: 'queued', state: 'queued', order: 1 }),
      item({ key: 'late', state: 'working', startedAt: 2_000, order: 2 }),
      item({ key: 'early', state: 'thinking', startedAt: 1_000, order: 3 }),
      item({ key: 'ask', state: 'waiting', startedAt: 3_000, order: 4 }),
      item({ key: 'lead', lead: true, state: 'thinking', startedAt: 500, order: 0 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['ask', 'lead', 'early', 'late', 'queued']);
  });

  it('lists the most recently finished first', () => {
    const rows = sortFinished([
      item({ key: 'old', finishedAt: 1_000 }),
      item({ key: 'unknown', finishedAt: null }),
      item({ key: 'new', finishedAt: 5_000 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['new', 'old', 'unknown']);
  });
});

describe('Agent TV list rows', () => {
  const SPARK = '00000000-0000-4000-8000-0000000000b1';
  const sparkJob = orchestration({
    depth: 'direct',
    depthSource: 'user',
    crew: [
      member({
        runId: SPARK,
        role: 'spark',
        name: 'Quill',
        spark: { id: '00000000-0000-4000-8000-0000000000b2', role: 'Reviewer', only: false },
      }),
    ],
  });

  function rows(status: 'running' | 'succeeded') {
    const detail = {
      runs: [run({ status, finishedAt: status === 'running' ? null : '2026-10-10T10:00:39.000Z' })],
      orchestrations: { [RUN_ID]: sparkJob },
      approvals: [],
      activity: {},
    } as unknown as ConversationDetail;
    return tvListRows(tvCast(detail)!, {});
  }

  it("lists the chat's agent while it runs and a finished Spark with its outcome and usage", () => {
    const { running, finished } = rows('running');
    expect(running.map((row) => [row.name, row.lead, row.role])).toEqual([['Claude', true, null]]);
    expect(finished.map((row) => [row.name, row.role, outcomeOf(row.state)])).toEqual([
      ['Quill', 'Reviewer', 'passed'],
    ]);
    expect(rowUsage(finished[0]!)).toEqual(['12.4K tokens', '$0.03', '4 tool uses']);
    expect(finished[0]!.durationMs).toBe(38_000);
  });

  it('moves the agent to finished once the turn ends', () => {
    const { running, finished } = rows('succeeded');
    expect(running).toEqual([]);
    expect(finished.map((row) => row.name).sort()).toEqual(['Claude', 'Quill']);
  });
});
