import { describe, expect, it } from 'vitest';
import type { CrewMember, OrchestrationDecision } from '@spark-outpost/contracts';
import { mergeConflictCard } from './checkpoint.ts';
import { finalText } from './final-message.ts';
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
    routing: 'auto',
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

describe('checkpoint cards', () => {
  it('offers no reconciling Builder for a copy that collides with your files', () => {
    const card = mergeConflictCard({ first: 'your version', second: 'Bolt', files: [] }, 'x');
    expect(card.options.map((option) => option.name)).toEqual([
      'Keep your version',
      "Keep Bolt's",
      'Stop',
    ]);
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

  it('leads a split run with the piece summary instead of the last Builder', () => {
    const text = finalText(
      [result('builder', 'Fixed the limit: 0 bug'), result('critic', 'Verdict: looks good')],
      'looks_good',
      [],
      false,
      [],
      'Built in 2 pieces:\n- P1 · CSV\n- P2 · Limiter',
    );
    expect(text).toBe(
      'Built in 2 pieces:\n- P1 · CSV\n- P2 · Limiter\n\nAI review by critic label: looks good.',
    );
  });

  it('describes the whole change across fix rounds, with one line for the fixes (C)', () => {
    const turn = (reason: 'first' | 'fix' | 'escalate', text: string) => ({
      ...result('builder', text),
      reason,
    });
    const built =
      'I made all three changes.\n\n- `src/csv-export.ts`: uploadsToCsv.\n- `src/rate-limit.ts`: RateLimiter.\n- README lists both.';
    const text = finalText(
      [
        turn('first', built),
        result('critic', 'Verdict: concerns'),
        turn('fix', 'Out-of-order calls no longer reopen a spent window. Added a test.'),
        result('critic', 'Verdict: concerns'),
        turn('fix', '- A call in an earlier window now counts against that window.'),
        result('critic', 'Verdict: looks good'),
      ],
      'looks_good',
      [],
      false,
    );
    expect(text).toBe(
      `${built}\n\nFixes after review and checks: Out-of-order calls no longer reopen a spent window. A call in an earlier window now counts against that window.\n\nAI review by critic label: looks good.`,
    );
  });

  it('never leads with a recheck turn (H)', () => {
    const text = finalText(
      [
        { ...result('builder', 'Added the export.'), reason: 'first' as const },
        {
          ...result('builder', 'I checked again and found nothing missing.'),
          reason: 'escalate' as const,
        },
      ],
      null,
      [],
      false,
    );
    expect(text.startsWith('Added the export.')).toBe(true);
  });

  it('answers a review-only request with the Critic’s own findings (dev-day s07)', () => {
    const review =
      'Findings:\n- `plural()` now says "1 runs" is fine but returns the singular for 0\n- `median()` sorts in place\nVerdict: concerns';
    const text = finalText([result('critic', review)], 'concerns', ['plural', 'median'], false);
    expect(text).toBe(`${review}\n\nAI review by critic label: concerns.`);
  });
});
