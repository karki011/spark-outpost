import { describe, expect, it } from 'vitest';
import type { CrewMember, OrchestrationDecision } from '@spark-outpost/contracts';
import { buildOrchestration, orchestrationTotals, type OrchestrationRow } from './view.ts';

const member = (
  role: CrewMember['role'],
  provider: string,
  model: string,
  tokens: number,
  costUsd: number,
): CrewMember => ({
  runId: crypto.randomUUID(),
  role,
  stepIndex: 0,
  attempt: 1,
  name: role,
  agentLabel: role,
  provider,
  model,
  modelLabel: null,
  effort: 'high',
  mode: 'ask',
  routedBy: 'jev',
  autoWouldUse: null,
  planStep: null,
  status: 'succeeded',
  error: null,
  tokens,
  costUsd,
  costSource: 'estimated',
  durationMs: 1000,
  toolCalls: 2,
  quality: null,
  verdict: null,
  startedAt: null,
  finishedAt: null,
});

const decision = (
  jevStatus: OrchestrationDecision['jevStatus'],
  costUsd: number | null,
  tokens: number | null = null,
) => ({ jevStatus, costUsd, tokens }) as OrchestrationDecision;

describe('orchestration totals', () => {
  it('adds up the crew by role and by model, with Jev as its own line', () => {
    const totals = orchestrationTotals(
      [
        member('scout', 'claude', 'opus', 100, 0.5),
        member('builder', 'claude', 'sonnet', 50, 0.1),
        member('builder', 'claude', 'sonnet', 70, 0.2),
        member('critic', 'codex', 'gpt-6-sol', 30, 0.05),
      ],
      [
        decision('answered', 0.0001, 1_200),
        decision('not_asked', null),
        decision('not_connected', null),
      ],
    );
    expect(totals).toMatchObject({
      runs: 4,
      tokens: 250,
      toolCalls: 8,
      durationMs: 4000,
      jevCalls: 1,
      jevTokens: 1_200,
      jevCostUsd: 0.0001,
    });
    expect(totals.costUsd).toBeCloseTo(0.85);
    expect(totals.byRole.map((group) => [group.role, group.runs, group.tokens])).toEqual([
      ['scout', 1, 100],
      ['builder', 2, 120],
      ['critic', 1, 30],
    ]);
    expect(totals.byModel.map((group) => [group.provider, group.model, group.runs])).toEqual([
      ['claude', 'opus', 1],
      ['claude', 'sonnet', 2],
      ['codex', 'gpt-6-sol', 1],
    ]);
  });
});

describe('the run that answers a question during a build', () => {
  const row: OrchestrationRow = {
    run_id: crypto.randomUUID(),
    conversation_id: crypto.randomUUID(),
    task_id: null,
    status: 'running',
    run_error: null,
    level: null,
    provider: 'claude',
    plan_version: null,
    phase: 'building',
    depth: 'execute',
    depth_source: 'rules',
    risk: 'edits',
    retries: 0,
    active_ms: 0,
    tool_calls: 0,
    error: null,
    updated_at: new Date(0),
  };
  const builder = member('builder', 'claude', 'sonnet', 50, 0.1);
  const answer = { ...member('scout', 'claude', 'sonnet', 40, 0.3), answers: crypto.randomUUID() };

  it('is left out of the crew list and the crew counts', () => {
    const view = buildOrchestration(row, [builder, answer], [], []);
    expect(view.crew.map((entry) => entry.runId)).toEqual([builder.runId]);
    expect(view.answers?.map((entry) => entry.runId)).toEqual([answer.runId]);
    expect(view.totals.runs).toBe(1);
    expect(view.totals.byRole.map((group) => [group.role, group.runs])).toEqual([['builder', 1]]);
  });

  it('still counts in the tokens and cost of the turn', () => {
    const view = buildOrchestration(row, [builder, answer], [], []);
    expect(view.totals.tokens).toBe(90);
    expect(view.totals.costUsd).toBeCloseTo(0.4);
    expect(view.usage?.costUsd).toBeCloseTo(0.4);
    expect(view.totals.byModel.map((group) => [group.model, group.runs, group.tokens])).toEqual([
      ['sonnet', 1, 90],
    ]);
  });

  it('adds no answers list to a turn without one', () => {
    expect(buildOrchestration(row, [builder], [], [])).not.toHaveProperty('answers');
  });
});
