import { describe, expect, it } from 'vitest';
import type { CrewMember, OrchestrationDecision } from '@spark-outpost/contracts';
import {
  clarifiedRequest,
  clarifyCard,
  clarifyDepths,
  depthFromClarify,
  planCard,
} from './checkpoint.ts';
import { finalText } from './final-message.ts';
import { orchestrationTotals } from './view.ts';

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
        member('architect', 'claude', 'opus', 100, 0.5),
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
      ['architect', 1, 100],
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

describe('checkpoint cards', () => {
  it("offers Jev's top depths, a free answer, the rules and Stop, and maps the answer back", () => {
    const depths = clarifyDepths(
      {
        model: 'jev',
        answers: {
          depth: {
            type: 'choice',
            choice: 'execute',
            probabilities: { plan_execute: 0.3, execute: 0.45, direct: 0.25 },
            confidence: 0.45,
          },
        },
      },
      'execute',
    );
    expect(depths).toEqual(['execute', 'plan_execute', 'direct']);
    const card = clarifyCard(depths, 'unsure');
    expect(card.options.map((option) => option.optionId)).toEqual([
      'option:0',
      'option:1',
      'option:2',
      'answer',
      'rules',
      'stop',
    ]);
    expect(depthFromClarify(card, 'option:1', 'execute')).toBe('plan_execute');
    expect(depthFromClarify(card, 'rules', 'execute')).toBe('execute');
    expect(depthFromClarify(card, 'answer', 'execute')).toBe('execute');
    expect(depthFromClarify(card, 'stop', 'execute')).toBeNull();
  });

  it('adds a free-text answer to the request', () => {
    expect(clarifiedRequest('Fix the divider', 'Use local time')).toBe(
      'Fix the divider\n\nThe user clarified: Use local time',
    );
  });

  it('puts the plan and its version on the plan card', () => {
    const card = planCard(
      [{ content: 'Do it', priority: 'high', status: 'pending' }],
      2,
      'Approve the plan.',
    );
    expect(card.title).toBe('Approve the plan v2');
    expect(card.payload).toMatchObject({
      kind: 'plan',
      planVersion: 2,
      plan: [{ content: 'Do it' }],
    });
    expect(card.options.map((option) => [option.optionId, option.kind])).toEqual([
      ['approve', 'allow_once'],
      ['edit', 'reject_once'],
      ['stop', 'reject_once'],
    ]);
  });
});

describe('the final reply', () => {
  const result = (role: 'architect' | 'builder' | 'critic', text: string, inPlace = false) => ({
    role,
    runId: 'r',
    stepIndex: 0,
    label: `${role} label`,
    outcome: 'succeeded' as const,
    error: null,
    text,
    toolCalls: 0,
    inPlace,
    name: role,
    steps: [0],
    ticked: [],
    tools: [],
  });

  it('adds nothing for a single in-place agent', () => {
    expect(finalText([result('builder', 'Done', true)], null, [], true)).toBe('');
  });

  it("shows the last Builder's reply and the AI review", () => {
    const text = finalText(
      [
        result('architect', 'Plan'),
        result('builder', 'Built it'),
        result('critic', 'Verdict: concerns'),
      ],
      'concerns',
      ['Missing test'],
      false,
    );
    expect(text).toBe('Built it\n\nAI review by critic label: concerns.\n- Missing test');
  });
});
