import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type JevIntake } from '@spark-outpost/contracts';
import { activeTime, exceededLimit, extendLimits } from './budget.ts';
import { asksForPlan, asksForRetry, asksToKeep, autoContinueOption } from './checkpoint-policy.ts';
import { chooseDepth, ONE_SPOT_REASON, refineDepth, ruleDepth, trustedRisk } from './depth.ts';
import { oneTierUp, strongerEffort, tierLadder, topTier } from './tiers.ts';

const jev = (
  depth: JevIntake['depth'],
  risk: JevIntake['risk'],
  riskConfidence = 0.9,
): JevIntake => ({
  intent: 'bug_fix',
  complexity: 1,
  risk,
  injection: null,
  depth,
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'medium',
  confidence: 0.8,
  routeConfidence: 0.9,
  confidences: { risk: riskConfidence },
});

describe('depth fallback', () => {
  it('uses the rules by mode and risk when Jev is not acted on', () => {
    expect(ruleDepth('chat', 'destructive')).toBe('direct');
    expect(ruleDepth('ask', 'edits')).toBe('direct');
    expect(ruleDepth('do', 'read-only')).toBe('execute');
    expect(ruleDepth('do', 'edits')).toBe('execute');
    expect(ruleDepth('do', 'multi-file')).toBe('plan_execute');
    expect(ruleDepth('do', 'destructive')).toBe('plan_execute_review');
  });

  it("trusts Jev's risk only when its own confidence passes, and never outside Do", () => {
    expect(trustedRisk('do', jev('execute', 'destructive'))).toBe('destructive');
    expect(trustedRisk('do', jev('execute', 'destructive', 0.3))).toBe('edits');
    expect(trustedRisk('ask', jev('execute', 'destructive'))).toBe('read-only');
    expect(trustedRisk('do', null)).toBe('edits');
  });

  it("uses Jev's depth only when the gate acts, and never a deeper one than the mode allows", () => {
    expect(chooseDepth('do', 'edits', jev('plan_execute', 'edits'), 'act')).toEqual({
      depth: 'plan_execute',
      source: 'jev',
      reason: null,
    });
    expect(chooseDepth('do', 'multi-file', jev('execute', 'multi-file'), 'fallback')).toEqual({
      depth: 'plan_execute',
      source: 'rules',
      reason: null,
    });
    expect(chooseDepth('do', 'edits', jev('execute', 'edits'), 'ask')).toEqual({
      depth: 'execute',
      source: 'rules',
      reason: null,
    });
    expect(chooseDepth('ask', 'read-only', jev('plan_execute_review', 'edits'), 'act')).toEqual({
      depth: 'direct',
      source: 'jev',
      reason: null,
    });
    expect(chooseDepth('do', 'edits', null, null)).toEqual({
      depth: 'execute',
      source: 'rules',
      reason: null,
    });
  });

  const planned = { depth: 'plan_execute' as const, source: 'rules' as const, reason: null };
  const sure = (depth: JevIntake['depth'], confidence: number, depthConfidence = 0.9) => ({
    ...jev(depth, 'multi-file'),
    confidence,
    confidences: { risk: 0.9, depth: depthConfidence },
  });

  it('skips the Architect when the request already names up to 6 files', () => {
    const refined = refineDepth(planned, 'multi-file', 4, sure('plan_execute', 0.78));
    expect(refined).toMatchObject({ depth: 'execute', source: 'rules' });
    expect(refined.reason).toBe(
      'The request names its 4 files, so one Builder works from it without an Architect.',
    );
    expect(refineDepth(planned, 'multi-file', 7, sure('plan_execute', 0.9)).depth).toBe(
      'plan_execute',
    );
    expect(refineDepth(planned, 'multi-file', 0, sure('plan_execute', 0.9)).depth).toBe(
      'plan_execute',
    );
    expect(refineDepth(planned, 'multi-file', 3, sure('plan_execute', 0.69)).depth).toBe(
      'plan_execute',
    );
    expect(refineDepth(planned, 'multi-file', 3, null).depth).toBe('plan_execute');
    const reviewed = { ...planned, depth: 'plan_execute_review' as const };
    expect(refineDepth(reviewed, 'destructive', 2, sure('plan_execute', 0.9))).toBe(reviewed);
  });

  it('keeps the Critic when Jev suggests a review, even below the act threshold', () => {
    const refined = refineDepth(planned, 'multi-file', 3, sure('plan_execute_review', 0.77));
    expect(refined.depth).toBe('plan_execute_review');
    expect(refined.reason).toMatch(/Jev suggested a review/);
    expect(refineDepth(planned, 'multi-file', 3, sure('plan_execute_review', 0.8, 0.4)).depth).toBe(
      'execute',
    );
  });

  it('skips the Architect when Jev places a vague request in one spot with confidence', () => {
    const oneSpot = (scope: number, overall = 0.8) => ({
      ...sure('plan_execute', overall),
      scope: 'one_spot' as const,
      confidences: { risk: 0.9, depth: 0.9, scope },
    });
    const refined = refineDepth(planned, 'multi-file', 0, oneSpot(0.75));
    expect(refined).toMatchObject({ depth: 'execute', reason: ONE_SPOT_REASON });
    expect(refineDepth(planned, 'multi-file', 0, oneSpot(0.6)).depth).toBe('plan_execute');
    expect(refineDepth(planned, 'multi-file', 0, oneSpot(0.9, 0.65)).depth).toBe('plan_execute');
    const reviewed = { ...planned, depth: 'plan_execute_review' as const };
    expect(refineDepth(reviewed, 'destructive', 0, oneSpot(0.95)).depth).toBe(
      'plan_execute_review',
    );
    const suggested = { ...oneSpot(0.95), depth: 'plan_execute_review' as const };
    expect(refineDepth(planned, 'multi-file', 0, suggested).depth).toBe('plan_execute_review');
  });
});

describe('level checkpoints', () => {
  it('asks for the plan by level and risk', () => {
    const table = (['hands-on', 'balanced', 'hands-off', 'full-auto'] as const).map((level) =>
      (['edits', 'multi-file', 'destructive'] as const).map((risk) => asksForPlan(level, risk)),
    );
    expect(table).toEqual([
      [true, true, true],
      [false, true, true],
      [false, false, true],
      [false, false, false],
    ]);
  });

  it('confirms retries by level and confidence', () => {
    expect(asksForRetry('hands-on', 1)).toBe(true);
    expect(asksForRetry('balanced', 0.9)).toBe(false);
    expect(asksForRetry('balanced', 0.89)).toBe(true);
    expect(asksForRetry('balanced', null)).toBe(true);
    expect(asksForRetry('hands-off', 0.1)).toBe(false);
    expect(asksForRetry('full-auto', 0.1)).toBe(false);
  });

  it('asks to keep changes at Hands-on and Balanced when files changed', () => {
    expect(asksToKeep('hands-on', 1)).toBe(true);
    expect(asksToKeep('balanced', 3)).toBe(true);
    expect(asksToKeep('balanced', 0)).toBe(false);
    expect(asksToKeep('hands-off', 3)).toBe(false);
    expect(asksToKeep('full-auto', 3)).toBe(false);
  });
});

describe('budgets', () => {
  const limits = { activeLimitMs: 1000, toolCallLimit: 3, costCapUsd: null };

  it('excludes approval waits from active time', () => {
    expect(activeTime(10_000, 9_500)).toBe(500);
    expect(activeTime(100, 500)).toBe(0);
  });

  it('names the first limit that ran out', () => {
    expect(exceededLimit({ activeMs: 999, toolCalls: 2, costUsd: 5 }, limits)).toBeNull();
    expect(exceededLimit({ activeMs: 1000, toolCalls: 0, costUsd: 0 }, limits)).toBe('time');
    expect(exceededLimit({ activeMs: 0, toolCalls: 3, costUsd: 0 }, limits)).toBe('tool_calls');
    expect(
      exceededLimit({ activeMs: 0, toolCalls: 0, costUsd: 2 }, { ...limits, costCapUsd: 2 }),
    ).toBe('cost');
  });

  it('continuing grants one more full allowance from where you are', () => {
    const usage = { activeMs: 1200, toolCalls: 5, costUsd: 0 };
    expect(extendLimits(limits, usage, limits)).toEqual({
      activeLimitMs: 2200,
      toolCallLimit: 8,
      costCapUsd: null,
    });
  });
});

describe('model tiers', () => {
  const claude = [
    { id: 'default', label: 'Default (recommended)' },
    { id: 'opus[1m]', label: 'Opus 5.5' },
    { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' },
    { id: 'sonnet', label: 'Sonnet 5' },
    { id: 'haiku', label: 'Haiku 4.5' },
  ];
  const codex = [
    { id: 'gpt-6-astra', label: '6 Astra' },
    { id: 'gpt-6-sol', label: '6 Sol' },
    { id: 'gpt-6-luna', label: '6 Luna' },
  ];

  it('orders Haiku, Sonnet, Opus and the Codex equivalents', () => {
    expect(tierLadder(claude).map((model) => model.id)).toEqual(['haiku', 'sonnet', 'opus[1m]']);
    expect(tierLadder(codex).map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-6-astra',
    ]);
    expect(topTier(claude)?.id).toBe('opus[1m]');
  });

  it('escalates one tier at a time and stops at the top', () => {
    expect(oneTierUp(claude, 'haiku')?.id).toBe('sonnet');
    expect(oneTierUp(claude, 'sonnet')?.id).toBe('opus[1m]');
    expect(oneTierUp(claude, 'opus[1m]')).toBeNull();
    expect(oneTierUp(claude, 'default')).toBeNull();
  });

  it('raises effort when the model is already at the top, never to max', () => {
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'medium')).toBe('high');
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'high')).toBe('high');
  });
});

describe('auto-continue', () => {
  const ask = (kind: Parameters<typeof autoContinueOption>[0]['kind'], agentAsked = false) =>
    autoContinueOption({ kind, fromJev: true, agentAsked });

  it("takes the safe default on Jev's own questions", () => {
    expect(ask('clarify')).toBe(CHECKPOINT_OPTION.clarifyRules);
    expect(ask('retry')).toBe(CHECKPOINT_OPTION.finish);
    expect(ask('needs_input')).toBe(CHECKPOINT_OPTION.clarifyRules);
  });

  it('never auto-continues an agent question, the rules, or the user-owned cards', () => {
    expect(ask('needs_input', true)).toBeNull();
    expect(autoContinueOption({ kind: 'retry', fromJev: false, agentAsked: false })).toBeNull();
    for (const kind of ['plan', 'accept', 'budget', 'merge_conflict'] as const) {
      expect(ask(kind)).toBeNull();
    }
  });
});
