import { describe, expect, it } from 'vitest';
import type { AuditRunSummary, ProtocolLogEntry } from '@spark-outpost/contracts';
import {
  auditTurns,
  entrySubagent,
  entrySummary,
  formatDuration,
  jsonTokens,
  runLabel,
  subagentNames,
  tickLabel,
  waterfall,
} from './audit-model.ts';

const T0 = Date.parse('2026-09-26T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

function run(
  id: string,
  message: string,
  start: number,
  end: number | null,
  extra: Partial<AuditRunSummary> = {},
): AuditRunSummary {
  return {
    runId: id,
    userMessageId: message,
    provider: 'claude',
    role: 'Scout',
    runMode: 'ask',
    model: 'sonnet',
    effort: null,
    mode: null,
    status: end === null ? 'running' : 'succeeded',
    createdAt: at(start),
    startedAt: at(start),
    finishedAt: end === null ? null : at(end),
    approvalWaits: [],
    durationMs: null,
    toolCallCount: null,
    inputTokens: null,
    outputTokens: null,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    thoughtTokens: null,
    totalTokens: null,
    costUsd: null,
    costSource: null,
    logEntries: 0,
    logPruned: false,
    methods: [],
    ...extra,
  };
}

describe('audit turns', () => {
  it('groups runs by the user message that started them, in order', () => {
    const turns = auditTurns([run('a', 'm1', 0, 1), run('b', 'm2', 2, 3), run('c', 'm1', 4, 5)]);
    expect(turns.map((turn) => [turn.userMessageId, turn.runs.map((r) => r.runId)])).toEqual([
      ['m1', ['a', 'c']],
      ['m2', ['b']],
    ]);
  });
});

describe('waterfall', () => {
  it('places runs and approval waits on a shared, rounded time scale', () => {
    const chart = waterfall(
      {
        userMessageId: 'm1',
        runs: [
          run('a', 'm1', 0, 20),
          run('b', 'm1', 10, 50, {
            approvalWaits: [{ start: at(30), end: at(45) }],
          }),
        ],
      },
      T0,
    );
    expect(chart.wallMs).toBe(50_000);
    expect(chart.waitMs).toBe(15_000);
    expect(chart.scaleSeconds).toBe(50);
    expect(chart.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(chart.bars.map((bar) => [bar.left, bar.width])).toEqual([
      [0, 40],
      [20, 80],
    ]);
    expect(chart.waits).toEqual([{ left: 60, width: 30, auto: false }]);
  });

  it('runs a live bar and an open wait up to now', () => {
    const chart = waterfall(
      {
        userMessageId: 'm1',
        runs: [
          run('a', 'm1', 0, null, {
            status: 'awaiting_approval',
            approvalWaits: [{ start: at(5), end: null }],
          }),
        ],
      },
      T0 + 10_000,
    );
    expect(chart.bars[0]).toMatchObject({ live: true, seconds: 10, width: 100 });
    expect(chart.waitMs).toBe(5000);
  });
});

describe('labels', () => {
  it('formats durations and axis ticks', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(tickLabel(30)).toBe('30s');
    expect(tickLabel(90)).toBe('1m30');
  });

  it('summarises protocol messages in one line', () => {
    const entry = (patch: Partial<ProtocolLogEntry>): ProtocolLogEntry => ({
      runId: crypto.randomUUID(),
      seq: 1,
      at: at(0),
      direction: 'from_agent',
      kind: 'notification',
      method: 'session/update',
      rpcId: null,
      sizeBytes: 10,
      truncated: false,
      payload: {},
      prevHash: null,
      hash: 'h',
      ...patch,
    });
    expect(
      entrySummary(
        entry({
          payload: { params: { update: { sessionUpdate: 'tool_call', title: 'Read a.ts' } } },
        }),
      ),
    ).toBe('tool_call · Read a.ts');
    const spawned = entry({
      payload: {
        params: {
          sessionId: 'root',
          update: { sessionUpdate: 'subagent_spawned', subagentSessionId: 's1', name: 'Explore' },
        },
      },
    });
    const childCall = entry({
      payload: {
        params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', title: 'Read a.ts' } },
      },
    });
    const ended = entry({
      payload: {
        params: {
          sessionId: 'root',
          update: {
            sessionUpdate: 'subagent_state_update',
            subagentSessionId: 's1',
            state: 'failed',
          },
        },
      },
    });
    const names = subagentNames([spawned, childCall, ended]);
    expect(entrySummary(childCall, entrySubagent(childCall, names))).toBe(
      'tool_call · Read a.ts · sub-agent Explore',
    );
    expect(entrySummary(ended, entrySubagent(ended, names))).toBe(
      'subagent_state_update · failed · sub-agent Explore',
    );
    expect(entrySubagent(entry({ payload: { params: { sessionId: 'root' } } }), names)).toBeNull();
    const asked = entry({
      kind: 'request',
      method: 'session/request_permission',
      payload: { params: { sessionId: 's1', toolCall: { toolCallId: 't1' } } },
    });
    expect(entrySummary(asked, entrySubagent(asked, names))).toBe(
      'session/request_permission · sub-agent Explore',
    );
    expect(entrySummary(entry({ kind: 'response', method: 'session/prompt' }))).toBe(
      'session/prompt · reply',
    );
    expect(
      entrySummary(
        entry({
          direction: 'harness',
          kind: 'check',
          method: 'check/run',
          payload: { command: 'npm test', outcome: 'timed_out' },
        }),
      ),
    ).toBe('npm test · timed out');
    expect(
      entrySummary(
        entry({
          kind: 'error',
          method: 'fs/read_text_file',
          payload: { error: { message: 'no' } },
        }),
      ),
    ).toBe('fs/read_text_file failed · no');
    expect(entrySummary(entry({ kind: 'stderr', method: null, payload: { text: 'boom' } }))).toBe(
      'boom',
    );
    expect(entrySummary(entry({ truncated: true }))).toBe('session/update · truncated');
  });
});

describe('jsonTokens', () => {
  it('splits pretty JSON into highlightable tokens without losing text', () => {
    const value = { id: 3, ok: true, name: 'a "b"', none: null, list: [-1.5e3] };
    const tokens = jsonTokens(value);
    expect(tokens.map((token) => token.text).join('')).toBe(JSON.stringify(value, null, 2));
    expect(tokens.filter((token) => token.kind === 'key').map((token) => token.text)).toEqual([
      '"id"',
      '"ok"',
      '"name"',
      '"none"',
      '"list"',
    ]);
    expect(tokens.find((token) => token.kind === 'string')?.text).toBe('"a \\"b\\""');
    expect(tokens.filter((token) => token.kind === 'literal').map((t) => t.text)).toEqual([
      'true',
      'null',
    ]);
    expect(tokens.filter((token) => token.kind === 'number').map((t) => t.text)).toEqual([
      '3',
      '-1500',
    ]);
  });

  it('highlights only the head of a long payload and keeps the rest as plain text', () => {
    const value = { rows: Array.from({ length: 200 }, (_, index) => ({ id: index, ok: true })) };
    const tokens = jsonTokens(value, 400);
    expect(tokens.map((token) => token.text).join('')).toBe(JSON.stringify(value, null, 2));
    expect(tokens.filter((token) => token.kind !== 'plain').length).toBeLessThan(200);
    expect(tokens.at(-1)?.kind).toBe('plain');
  });
});

describe('runLabel', () => {
  it('names a plain run by its agent once, and a stored helper by its role and agent', () => {
    expect(runLabel({ role: 'Claude', provider: 'claude' })).toBe('Claude');
    expect(runLabel({ role: 'Critic', provider: 'codex' })).toBe('Critic · Codex');
  });
});
