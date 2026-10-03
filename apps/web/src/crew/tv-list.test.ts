import type { ConversationDetail, Orchestration, Run } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { crewAgents } from './crew-projection.ts';
import { checkpoint, member, orchestration } from './test-orchestration.ts';
import {
  formatElapsed,
  outcomeOf,
  rowUsage,
  sortFinished,
  sortRunning,
  tvListRows,
  type TvRow,
} from './tv-list.ts';

const PARENT = '00000000-0000-4000-8000-000000000001';

function item(overrides: Partial<TvRow>): TvRow {
  return {
    key: 'k',
    runId: 'r',
    agentId: 'r',
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
    dispatcher: false,
    messageable: true,
    piece: null,
    order: 1,
    ...overrides,
  };
}

function detail(runs: Partial<Run>[] = []): ConversationDetail {
  return { runs, approvals: [], activity: {} } as unknown as ConversationDetail;
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
      item({ key: 'jev', dispatcher: true, state: 'done', startedAt: 500, order: 0 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['ask', 'jev', 'early', 'late', 'queued']);
  });

  it('ranks Jev first only when he is the one asking', () => {
    const ask = { approvalId: 'a', text: 'Needs you: keep these changes?' };
    const rows = sortRunning([
      item({ key: 'builder', state: 'working', startedAt: 1_000 }),
      item({ key: 'jev', dispatcher: true, state: 'waiting', ask, order: 0 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['jev', 'builder']);
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
  it('splits a live turn into running and finished rows with outcomes and usage', () => {
    const scout = member({
      runId: '00000000-0000-4000-8000-0000000000a2',
      role: 'scout',
      name: 'Wren',
      status: 'succeeded',
    });
    const builder = member({
      status: 'running',
      toolCalls: 3,
      finishedAt: null,
      planStep: 'Run the tests',
    });
    const turn = orchestration({ crew: [scout, builder] });
    const agents = crewAgents(turn);
    const { running, finished } = tvListRows(
      detail([{ id: PARENT, startedAt: '2026-09-26T10:02:00.000Z', finishedAt: null }]),
      turn,
      agents,
      {},
    );
    expect(running.map((row) => row.name)).toEqual(['Jev', 'Builder']);
    expect(running[0]).toMatchObject({ runId: PARENT, dispatcher: true });
    expect(running[1]).toMatchObject({
      runId: builder.runId,
      model: 'Sonnet 5 · medium',
      line: 'run the tests',
      toolCalls: 3,
      startedAt: Date.parse('2026-09-26T10:03:00.000Z'),
    });
    expect(rowUsage(running[1]!)).toEqual(['12.4K tokens', '$0.03', '3 tool uses']);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ name: 'Wren', role: 'Reader', durationMs: 38_000 });
    expect(outcomeOf(finished[0]!.state)).toBe('passed');
  });

  it('marks the agent behind a pending checkpoint as needing you', () => {
    const builder = member({ status: 'awaiting_approval', finishedAt: null });
    const pending = checkpoint({ kind: 'budget' }, { runId: builder.runId });
    const turn = orchestration({ crew: [builder], pendingCheckpoint: pending });
    const agents = crewAgents(turn);
    const ask = { approvalId: pending.id, text: 'Needs you: keep going?' };
    const { running } = tvListRows(detail(), turn, agents, { [builder.runId]: ask });
    expect(running[0]).toMatchObject({ name: 'Builder', state: 'waiting', ask });
  });

  it('labels each Builder with its piece and placement', () => {
    const bolt = member({
      status: 'running',
      finishedAt: null,
      pieceKey: 'P1',
      placement: 'shared',
    });
    const rivet = member({
      runId: '00000000-0000-4000-8000-0000000000a3',
      name: 'Rivet',
      status: 'running',
      finishedAt: null,
      pieceKey: 'P2',
      placement: 'worktree',
    });
    const pieces = {
      pieces: [
        {
          key: 'P1',
          title: 'Store',
          status: 'landed',
          dependsOn: [],
          placement: 'shared',
          owns: ['a.ts', 'b.ts'],
          builderName: 'Bolt',
          notesQueued: 0,
        },
        {
          key: 'P2',
          title: 'API',
          status: 'running',
          dependsOn: [],
          placement: 'worktree',
          owns: ['c.ts'],
          builderName: 'Rivet',
          notesQueued: 1,
        },
      ],
    } as unknown as Orchestration['pieces'];
    const turn = orchestration({ crew: [bolt, rivet], pieces });
    const { running } = tvListRows(detail(), turn, crewAgents(turn), {});
    expect(running.map((row) => [row.name, row.piece?.label, row.piece?.state])).toEqual([
      ['Jev', undefined, undefined],
      ['Builder', 'P1 · Store · shared tree · owns 2 files', 'landed'],
      ['Rivet', "P2 · API · Rivet's copy", 'running'],
    ]);
    expect(running[2]!.piece?.notes).toBe(1);
  });

  it('moves the whole turn to finished once it ends, stopped or failed', () => {
    const stopped = member({ status: 'cancelled' });
    const turn = orchestration({ status: 'cancelled', crew: [stopped] });
    const { running, finished } = tvListRows(detail(), turn, crewAgents(turn), {});
    expect(running).toEqual([]);
    expect(finished.map((row) => [row.name, outcomeOf(row.state)])).toEqual(
      expect.arrayContaining([
        ['Jev', 'stopped'],
        ['Builder', 'stopped'],
      ]),
    );
  });
});
