import { describe, expect, it } from 'vitest';
import type { CrewMember, OrchestrationDecision } from '@spark-outpost/contracts';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import {
  answerOrBuildCard,
  clarifiedRequest,
  mergeConflictCard,
  retryCard,
  stuckCard,
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

describe('checkpoint cards', () => {
  it('asks whether to answer or change the code', () => {
    expect(answerOrBuildCard('unsure').options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.justAnswer,
      CHECKPOINT_OPTION.makeChange,
      CHECKPOINT_OPTION.stop,
    ]);
  });

  it('offers Retry or Stop and report, and stops and reports by default', () => {
    const card = retryCard(null, null, 'Stopped after 2 retries.');
    expect(card.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.retry,
      CHECKPOINT_OPTION.stopReport,
    ]);
    expect(card.payload.autoOption).toBe(CHECKPOINT_OPTION.stopReport);
  });

  it('offers Continue or Stop and report after the loop guard stopped a Builder', () => {
    const card = stuckCard('Bolt', 'Bolt repeated `Read a.ts` 5 times in a row');
    expect(card.title).toBe('Bolt was repeating itself');
    expect(card.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.continueStuck,
      CHECKPOINT_OPTION.stopReport,
    ]);
  });

  it('offers no reconciling Builder for a copy that collides with your files', () => {
    const card = mergeConflictCard({ first: 'your version', second: 'Bolt', files: [] }, 'x');
    expect(card.options.map((option) => option.name)).toEqual([
      'Keep your version',
      "Keep Bolt's",
      'Stop',
    ]);
  });

  it('adds a free-text answer to the request', () => {
    expect(clarifiedRequest('Fix the divider', 'Use local time')).toBe(
      'Fix the divider\n\nThe user clarified: Use local time',
    );
  });
});

describe('the final reply', () => {
  const result = (role: 'scout' | 'builder' | 'critic', text: string, inPlace = false) => ({
    role,
    runId: 'r',
    label: `${role} label`,
    outcome: 'succeeded' as const,
    error: null,
    text,
    toolCalls: 0,
    inPlace,
    name: role,
    loop: null,
  });

  it('adds nothing for a single in-place agent', () => {
    expect(finalText([result('builder', 'Done', true)], null, [], true)).toBe('');
  });

  it("shows the last Builder's reply and the AI review", () => {
    const text = finalText(
      [result('builder', 'Built it'), result('critic', 'Verdict: concerns')],
      'concerns',
      ['Missing test'],
      false,
    );
    expect(text).toBe('Built it\n\nAI review by critic label: concerns.\n- Missing test');
  });
});
