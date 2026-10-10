import { describe, expect, it } from 'vitest';
import {
  LIVE_MIN_EVENTS,
  LONG_COMMAND_MS,
  liveOutputCheck,
  longCommandCheck,
  longest,
} from './command-output.ts';
import { gateMatchCheck, gatedToolCalls } from './gate-match.ts';
import { modelCalls } from '../rows/model-calls.ts';
import { reviewMarks } from '../rows/review-marks.ts';
import type { CommandTiming, LogRow, OutputEvent } from '../rows/types.ts';

const START = 1_000_000;

function command(overrides: Partial<CommandTiming> = {}): CommandTiming {
  return {
    id: 'c1',
    runId: 'r1',
    command: 'npm run ticker',
    startedAt: START,
    finishedAt: START + 91_000,
    exitCode: 0,
    status: 'completed',
    ...overrides,
  };
}

function everySecond(count: number, firstAfterMs = 1_000, stepMs = 1_000): OutputEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    commandId: 'c1',
    at: START + firstAfterMs + index * stepMs,
  }));
}

function update(seq: number, fields: Record<string, unknown>): LogRow {
  return {
    runId: 'r1',
    seq,
    at: START + seq,
    direction: 'from_agent',
    kind: 'notification',
    method: 'session/update',
    payload: { method: 'session/update', params: { update: fields } },
    unreviewed: false,
  };
}

describe('live output', () => {
  it('passes with 60 events during the command and the first within 3 seconds', () => {
    const check = liveOutputCheck(command(), everySecond(90));
    expect(check).toMatchObject({ pass: true, numbers: { events: 90, firstEventMs: 1_000 } });
  });

  it('fails when output arrives once at the end, late, or too rarely', () => {
    expect(liveOutputCheck(command(), [{ commandId: 'c1', at: START + 90_500 }]).pass).toBe(false);
    expect(liveOutputCheck(command(), everySecond(90, 3_500, 900)).pass).toBe(false);
    expect(liveOutputCheck(command(), everySecond(LIVE_MIN_EVENTS - 1)).pass).toBe(false);
    expect(liveOutputCheck(null, []).pass).toBe(false);
  });

  it('counts only events of that command that came before it ended', () => {
    const late = everySecond(90).map((event) => ({ ...event, at: event.at + 200_000 }));
    const other = everySecond(90).map((event) => ({ ...event, commandId: 'c2' }));
    expect(liveOutputCheck(command(), [...late, ...other]).numbers.events).toBe(0);
  });

  it('picks the longest command that matches', () => {
    const short = command({ id: 'short', finishedAt: START + 2_000 });
    const other = command({ id: 'other', command: 'npm test', finishedAt: START + 500_000 });
    expect(longest([short, command(), other], /ticker/)?.id).toBe('c1');
    expect(longest([other], /ticker/)).toBeNull();
  });
});

describe('long command', () => {
  const full = command({
    command: 'npm run check:slow',
    finishedAt: START + LONG_COMMAND_MS + 800,
  });

  it('passes when it ran 15 minutes with output arriving throughout', () => {
    expect(longCommandCheck(full, everySecond(90, 100, 10_000)).pass).toBe(true);
  });

  it('fails when it was cut short, never finished or went quiet', () => {
    const cut = command({ finishedAt: START + 120_000 });
    expect(longCommandCheck(cut, everySecond(12, 100, 10_000)).pass).toBe(false);
    expect(longCommandCheck(command({ finishedAt: null }), everySecond(5)).pass).toBe(false);
    expect(longCommandCheck(full, everySecond(10, 100, 10_000)).pass).toBe(false);
    expect(longCommandCheck(full, []).pass).toBe(false);
  });
});

describe('every call seen by the gate', () => {
  const rows = [
    update(1, { sessionUpdate: 'tool_call', toolCallId: 'read-1', kind: 'read' }),
    update(2, { sessionUpdate: 'tool_call', toolCallId: 'edit-1', kind: 'edit' }),
    update(3, { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' }),
    update(4, { sessionUpdate: 'tool_call', toolCallId: 'run-1' }),
    update(5, { sessionUpdate: 'tool_call_update', toolCallId: 'run-1', kind: 'execute' }),
    update(6, { sessionUpdate: 'agent_message_chunk', toolCallId: 'chat', kind: 'edit' }),
  ];
  const decision = (toolCallId: string, kind = 'execute', runId = 'r1') => ({
    runId,
    toolCallId,
    kind,
    title: '',
    text: '',
    status: 'allowed',
    decidedBy: 'level',
  });

  it('lists the edit and command calls the agent made', () => {
    expect(gatedToolCalls(rows)).toEqual([
      { runId: 'r1', toolCallId: 'edit-1', kind: 'edit' },
      { runId: 'r1', toolCallId: 'run-1', kind: 'execute' },
    ]);
    expect(gatedToolCalls([{ ...rows[1]!, direction: 'to_agent' }])).toEqual([]);
  });

  it('passes when the two lists match one to one and nothing ran without review', () => {
    const calls = gatedToolCalls(rows);
    const none = { sparkTools: 0, other: [] };
    expect(gateMatchCheck(calls, [decision('edit-1', 'edit'), decision('run-1')], none).pass).toBe(
      true,
    );
    const checkRun = decision('check:lint');
    expect(
      gateMatchCheck(calls, [decision('edit-1'), decision('run-1'), checkRun], none).pass,
    ).toBe(true);
  });

  it('fails on a call with no decision, a stray or repeated decision, or an unreviewed call', () => {
    const calls = gatedToolCalls(rows);
    const none = { sparkTools: 0, other: [] };
    const both = [decision('edit-1', 'edit'), decision('run-1')];
    expect(gateMatchCheck(calls, [both[0]!], none)).toMatchObject({
      pass: false,
      numbers: { unmatchedCalls: 1 },
    });
    expect(gateMatchCheck(calls, [...both, decision('ghost')], none).numbers.strayDecisions).toBe(
      1,
    );
    expect(gateMatchCheck(calls, [...both, both[1]!], none).numbers.repeated).toBe(1);
    const marked = { sparkTools: 0, other: [{ toolCallId: 'run-1', kind: 'execute', title: '' }] };
    expect(gateMatchCheck(calls, both, marked)).toMatchObject({
      pass: false,
      numbers: { ranWithoutReview: 1 },
    });
  });

  it('matches run by run when two runs use the same tool call id', () => {
    const second = rows.map((row) => ({ ...row, runId: 'r2' }));
    const calls = gatedToolCalls([...rows, ...second]);
    expect(calls).toHaveLength(4);
    const none = { sparkTools: 0, other: [] };
    const all = ['r1', 'r2'].flatMap((runId) => [
      decision('edit-1', 'edit', runId),
      decision('run-1', 'execute', runId),
    ]);
    expect(gateMatchCheck(calls, all, none).pass).toBe(true);
    expect(gateMatchCheck(calls, all.slice(0, 3), none).numbers.unmatchedCalls).toBe(1);
  });

  it('leaves out a call the agent ended as never run, and one that only read', () => {
    const neverRun = [
      ...rows,
      update(7, { sessionUpdate: 'tool_call', toolCallId: 'edit-2', kind: 'edit' }),
      update(8, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit-2',
        kind: 'think',
        status: 'failed',
      }),
    ];
    expect(gatedToolCalls(neverRun)).toEqual(gatedToolCalls(rows));
  });

  it('reports marks on Spark tool calls apart', () => {
    const calls = gatedToolCalls(rows);
    const both = [decision('edit-1', 'edit'), decision('run-1')];
    const check = gateMatchCheck(calls, both, { sparkTools: 2, other: [] });
    expect(check).toMatchObject({
      pass: true,
      numbers: { ranWithoutReview: 0, sparkToolMarks: 2 },
    });
    expect(check.detail).toContain('2 Spark tool calls marked');
  });
});

describe('ran without review marks', () => {
  const marked = (seq: number, fields: Record<string, unknown>): LogRow => ({
    ...update(seq, fields),
    unreviewed: true,
  });
  const sparkCall = { sessionUpdate: 'tool_call', kind: 'other', status: 'in_progress' };

  it('counts Spark tool calls apart from everything else', () => {
    const rows = [
      update(1, { ...sparkCall, toolCallId: 'docs-1', title: 'mcp__spark__spark_docs' }),
      marked(2, { sessionUpdate: 'tool_call_update', toolCallId: 'docs-1', status: 'completed' }),
      update(3, { ...sparkCall, toolCallId: 'docs-2', title: 'mcp__spark_outpost__spark_chats' }),
      marked(4, { sessionUpdate: 'tool_call_update', toolCallId: 'docs-2', status: 'failed' }),
      update(5, { sessionUpdate: 'tool_call', toolCallId: 'run-1', kind: 'execute', title: 'ls' }),
      marked(6, { sessionUpdate: 'tool_call_update', toolCallId: 'run-1', status: 'completed' }),
      update(7, { ...sparkCall, toolCallId: 'other-1', title: 'mcp__github__create_issue' }),
      marked(8, { sessionUpdate: 'tool_call_update', toolCallId: 'other-1', status: 'completed' }),
      marked(9, {
        sessionUpdate: 'tool_call',
        toolCallId: 'edit-1',
        kind: 'edit',
        title: 'mcp__spark__spark_docs',
        status: 'completed',
      }),
    ];
    expect(reviewMarks(rows)).toEqual({
      sparkTools: 2,
      other: [
        { toolCallId: 'run-1', kind: 'execute', title: 'ls' },
        { toolCallId: 'other-1', kind: 'other', title: 'mcp__github__create_issue' },
        { toolCallId: 'edit-1', kind: 'edit', title: 'mcp__spark__spark_docs' },
      ],
    });
  });

  it('does not mix up two runs that use the same tool call id', () => {
    const edit = update(1, { sessionUpdate: 'tool_call', toolCallId: 'call-1', kind: 'edit' });
    const docs = {
      ...update(2, { ...sparkCall, toolCallId: 'call-1', title: 'mcp__spark__spark_docs' }),
      runId: 'r2',
    };
    const done = {
      ...marked(3, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
      }),
      runId: 'r2',
    };
    expect(reviewMarks([edit, docs, done])).toEqual({ sparkTools: 1, other: [] });
  });

  it('finds none where nothing was marked', () => {
    const rows = [update(1, { ...sparkCall, toolCallId: 'docs-1', title: 'mcp__spark__x' })];
    expect(reviewMarks(rows)).toEqual({ sparkTools: 0, other: [] });
  });
});

describe('model calls', () => {
  const step = (seq: number, model: string | null) =>
    update(seq, {
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
      ...(model ? { _meta: { '_claude/model': model } } : {}),
    });

  it('counts one call for each usage update, whether or not it names a model', () => {
    expect(modelCalls([step(2, 'sonnet'), step(8, 'haiku'), step(9, null)])).toEqual([
      { seq: 2, model: 'sonnet' },
      { seq: 8, model: 'haiku' },
      { seq: 9, model: null },
    ]);
    expect(modelCalls([update(1, { sessionUpdate: 'tool_call', toolCallId: 'a' })])).toEqual([]);
  });
});
