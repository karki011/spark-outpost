import { describe, expect, it } from 'vitest';
import { isCard, metricsOf } from './metrics.ts';
import { dollars, recordLine, seconds } from './summary.ts';
import type { RunRecord } from './results.ts';
import type { AgentUsage } from './usage.ts';

function agent(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    provider: 'zai',
    model: 'glm-5.3',
    inputTokens: 1_000,
    outputTokens: 200,
    cachedReadTokens: 4_000,
    costUsd: 0.01,
    costSource: 'estimated',
    durationMs: 9_000,
    toolCalls: 7,
    ...overrides,
  };
}

const audit = { modelCalls: 5, ranWithoutReview: 2, sparkToolMarks: 3, railFlags: 1 };
const noEstimate = () => null;

describe('run metrics', () => {
  it('sums tokens, tool calls and cost over the agents of a turn', () => {
    const agents = [agent(), agent({ model: 'glm-5.3-flash', toolCalls: 1 })];
    const metrics = metricsOf('succeeded', 12_000, agents, audit, [], noEstimate);
    expect(metrics).toMatchObject({
      status: 'succeeded',
      runs: 2,
      models: ['glm-5.3', 'glm-5.3-flash'],
      modelCalls: 5,
      toolCalls: 8,
      wallMs: 12_000,
      agentMs: 18_000,
      tokens: { input: 2_000, cached: 8_000, output: 400 },
      costUsd: 0.02,
      costSource: 'spark',
      ranWithoutReview: 2,
      sparkToolMarks: 3,
      railFlags: 1,
    });
  });

  it('prices the tokens itself only when Spark recorded no cost', () => {
    const unpriced = [agent({ costUsd: 0, costSource: null })];
    const priced = metricsOf('succeeded', 1, unpriced, audit, [], () => 0.5);
    expect(priced).toMatchObject({ costUsd: 0.5, costSource: 'list-price-estimate', runs: 1 });
    const unknown = metricsOf('succeeded', 1, unpriced, audit, [], noEstimate);
    expect(unknown).toMatchObject({ costUsd: null, costSource: 'none' });
    expect(metricsOf('failed', 1, [], audit, [], noEstimate).costSource).toBe('none');
  });

  it('counts a card only when a person had to answer, and tallies every decision', () => {
    const decisions = [
      { status: 'allowed', decidedBy: 'level' },
      { status: 'allowed', decidedBy: 'level' },
      { status: 'denied', decidedBy: 'policy' },
      { status: 'denied', decidedBy: 'user' },
      { status: 'pending', decidedBy: null },
      { status: 'cancelled', decidedBy: 'stop' },
    ];
    const metrics = metricsOf('succeeded', 1, [agent()], audit, decisions, noEstimate);
    expect(metrics.cards).toBe(3);
    expect(metrics.decisions).toEqual({
      'allowed by level': 2,
      'denied by policy': 1,
      'denied by user': 1,
      'pending by nobody': 1,
      'cancelled by stop': 1,
    });
    expect(isCard({ status: 'allowed', decidedBy: 'allowlist' })).toBe(false);
  });
});

describe('the printed line for a run', () => {
  const record: RunRecord = {
    label: 'x',
    provider: 'claude',
    live: true,
    taskId: '1',
    taskNumber: 1,
    set: 'quality',
    mode: 'auto',
    attempt: 2,
    startedAt: '',
    runId: 'r',
    runIds: ['r'],
    baseCommit: 'c',
    pass: true,
    findings: [],
    metrics: metricsOf('succeeded', 43_200, [agent()], audit, [], noEstimate),
    answered: [],
    error: null,
    failure: null,
  };

  it('shows every measured number and no chat content', () => {
    expect(recordLine(record)).toBe(
      'claude task 1 auto #2: pass, 5 model calls, 7 tool calls, 43 s, 1000/4000/200 tokens in/cached/out, $0.0100, 0 cards, 2 ran without review, 3 Spark tool calls marked',
    );
  });

  it('ends with why a run had no answer', () => {
    const failure = { reason: '1 run failed: the agent is not signed in.' };
    expect(recordLine({ ...record, pass: false, failure })).toMatch(
      /^claude task 1 auto #2: FAIL, .*, why: 1 run failed: the agent is not signed in\.$/,
    );
  });

  it('shows the error of a run that could not be measured', () => {
    expect(recordLine({ ...record, pass: false, error: 'rate limited', metrics: null })).toBe(
      'claude task 1 auto #2: FAIL (rate limited)',
    );
    expect(seconds(1_540)).toBe('1.5 s');
    expect(dollars(null)).toBe('no cost');
    expect(dollars(12.345)).toBe('$12.35');
  });
});
