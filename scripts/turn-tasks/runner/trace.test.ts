import { describe, expect, it } from 'vitest';
import { toolCallFacts } from '../rows/tool-calls.ts';
import type { LogRow } from '../rows/types.ts';
import type { ApprovalFact } from '../tasks/types.ts';
import { REPLY_LIMIT, traceOf } from './trace.ts';
import type { AgentUsage } from './usage.ts';

function update(seq: number, fields: Record<string, unknown>, unreviewed = false): LogRow {
  return {
    runId: 'run-b',
    seq,
    at: seq,
    direction: 'from_agent',
    kind: 'notification',
    method: 'session/update',
    payload: { params: { update: fields } },
    unreviewed,
  };
}

function agent(provider: string, model: string, costUsd: number): AgentUsage {
  return {
    provider,
    model,
    inputTokens: 100,
    outputTokens: 10,
    cachedReadTokens: 1_000,
    costUsd,
    costSource: 'spark',
    durationMs: 2_000,
    toolCalls: 3,
  };
}

const approval: ApprovalFact = {
  runId: 'run-c',
  toolCallId: 'call-2',
  kind: 'execute',
  title: 'npx tsc --noEmit',
  text: '{}',
  status: 'allowed',
  decidedBy: 'user',
};

describe('tool call facts', () => {
  it('joins the updates of one call and keeps the review mark, title, status and paths', () => {
    const rows = [
      update(1, {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        kind: 'edit',
        title: 'Edit .env',
        status: 'pending',
        locations: [{ path: '/repo/.env' }],
      }),
      update(
        2,
        { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' },
        true,
      ),
      update(3, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }),
    ];
    expect(toolCallFacts(rows)).toEqual([
      {
        runId: 'run-b',
        toolCallId: 'call-1',
        kind: 'edit',
        title: 'Edit .env',
        status: 'completed',
        paths: ['/repo/.env'],
        unreviewed: true,
      },
    ]);
  });
});

describe('the trace kept with a run record', () => {
  const trace = traceOf({
    reply: 'x'.repeat(REPLY_LIMIT + 5),
    agents: [agent('zai', 'glm-5.3', 0.05), agent('claude', 'default', 0.24)],
    audit: {
      approvals: [approval],
      railFlags: ['secret'],
      unreviewed: 0,
      calls: toolCallFacts([
        update(1, {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          kind: 'execute',
          title: 'npm run ticker',
        }),
      ]),
    },
    reasons: new Map([['run-c call-2', 'Spark asks before commands in a question turn']]),
    commands: [
      {
        id: 'cmd-1',
        runId: 'run-b',
        command: 'npm run ticker',
        startedAt: 1_000,
        finishedAt: 91_000,
        exitCode: 0,
        status: 'completed',
      },
    ],
    outputs: [
      { commandId: 'cmd-1', at: 2_100 },
      { commandId: 'cmd-1', at: 3_100 },
      { commandId: 'other', at: 9 },
    ],
  });

  it('splits cost and tokens by run, so a second run on another provider is seen apart', () => {
    expect(trace.agents.map((item) => [item.provider, item.model, item.costUsd])).toEqual([
      ['zai', 'glm-5.3', 0.05],
      ['claude', 'default', 0.24],
    ]);
    expect(trace.agents[0]!.tokens).toEqual({ input: 100, cached: 1_000, output: 10 });
  });

  it('names each request, what it was and why Spark asked', () => {
    expect(trace.approvals).toEqual([
      {
        kind: 'execute',
        title: 'npx tsc --noEmit',
        status: 'allowed',
        decidedBy: 'user',
        why: 'Spark asks before commands in a question turn',
      },
    ]);
    expect(trace.calls).toEqual([
      {
        kind: 'execute',
        title: 'npm run ticker',
        status: null,
        unreviewed: false,
      },
    ]);
  });

  it('keeps each command with its length and its output events, and clips the reply', () => {
    expect(trace.commands).toEqual([
      {
        command: 'npm run ticker',
        ranMs: 90_000,
        exitCode: 0,
        status: 'completed',
        outputEvents: 2,
        firstOutputMs: 1_100,
      },
    ]);
    expect(trace.reply.startsWith('x'.repeat(REPLY_LIMIT))).toBe(true);
    expect(trace.reply.endsWith('[5 more]')).toBe(true);
    expect(trace.railFlags).toEqual(['secret']);
  });
});
