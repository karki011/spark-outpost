import { describe, expect, it } from 'vitest';
import type { AgentPick, Ratings } from '@spark-outpost/contracts';
import { handoffCostUsd, switchCostUsd, type ResumableSession } from './cache-switch.ts';
import type { PriorEscalation } from './escalation.ts';
import { candidates, plainFacts } from './route-fixtures.ts';
import { routeBuilder, type RouteContext, type RouteFacts } from './routing.ts';
import { KEPT_FOR_SESSION } from './session-keep.ts';

const NOW = new Date('2026-09-30T12:00:00Z');
const LABELS: Record<string, string> = { sonnet: 'Sonnet 5', 'opus[1m]': 'Opus 5.5' };

function chat(model = 'sonnet', routing: 'auto' | 'pinned' = 'auto'): RouteContext {
  return {
    routing,
    chat: { provider: 'claude', model, modelLabel: LABELS[model]!, effort: 'medium' },
    providerEffort: null,
    candidates,
    request: 'follow up on the report view',
    now: NOW,
  };
}

function ratings(complexity: number, stakes = 2, context = 2): Ratings {
  const rated = (value: number) => ({ value, confidence: 0.9 });
  return {
    complexity: rated(complexity),
    stakes: rated(stakes),
    ambiguity: rated(2),
    contextDependence: rated(context),
  };
}

function session(
  contextTokens: number,
  model = 'sonnet',
  extra: Partial<ResumableSession> = {},
): ResumableSession {
  const pick: AgentPick = { provider: 'claude', model, modelLabel: LABELS[model]!, effort: 'high' };
  return { pick, contextTokens, lastUsedAt: new Date(NOW.getTime() - 60_000), ...extra };
}

function followUp(values: Ratings, warm: ResumableSession | null, extra: Partial<RouteFacts> = {}) {
  return routeBuilder(chat(), { ...plainFacts, ratings: values, session: warm, ...extra });
}

describe('escalation routes for a follow-up in a long session', () => {
  const matrix = [
    { context: 50_000, rating: ratings(4), kind: 'switch', model: 'opus[1m]' },
    { context: 50_000, rating: ratings(4, 2, 5), kind: 'switch', model: 'opus[1m]' },
    { context: 180_000, rating: ratings(4), kind: 'brief', model: 'opus[1m]' },
    { context: 180_000, rating: ratings(4, 2, 3), kind: 'brief', model: 'opus[1m]' },
    { context: 180_000, rating: ratings(4, 2, 4), kind: 'compact', model: 'opus[1m]' },
    { context: 400_000, rating: ratings(5, 4, 2), kind: 'brief', model: 'opus[1m]' },
    { context: 400_000, rating: ratings(4, 2, 5), kind: 'compact', model: 'opus[1m]' },
    { context: 180_000, rating: ratings(3), kind: 'stay', model: 'sonnet' },
    { context: 180_000, rating: ratings(2), kind: 'stay', model: 'sonnet' },
    { context: 50_000, rating: ratings(1, 1), kind: 'stay', model: 'sonnet' },
    { context: 180_000, rating: ratings(2, 4), kind: 'stay', model: 'sonnet' },
  ] as const;

  it.each(matrix)(
    'at $context tokens routes $kind to $model',
    ({ context, rating, kind, model }) => {
      const route = followUp(rating, session(context));
      expect(route.escalation?.kind).toBe(kind);
      expect(route.pick.model).toBe(model);
    },
  );

  it('names the brief route and keeps the cheaper session warm', () => {
    const route = followUp(ratings(4), session(180_000));
    expect(route.rule).toBe(
      'hard follow-up at 180K → Opus 5.5 Builder with brief; Sonnet 5 session kept warm',
    );
    expect(route.sessionChoice).toMatchObject({
      kept: true,
      reason: 'kept the warm Sonnet 5 session for later turns (180K context)',
    });
    expect(route.escalation).toMatchObject({
      hard: true,
      contextTokens: 180_000,
      cacheWarm: true,
      from: { model: 'sonnet' },
      to: { model: 'opus[1m]' },
    });
    expect(route.escalation!.handoffUsd).toBeCloseTo(0.025 * 5, 6);
    expect(route.escalation!.fullSwitchUsd).toBeCloseTo(0.18 * (5 - 0.2), 6);
    const opus = route.score!.ranked.find((model) => model.id === 'opus[1m]')!;
    expect(opus.switchUsd).toBeCloseTo(0.025 * 5, 6);
  });

  it('names the compact route and leaves the session', () => {
    const route = followUp(ratings(4, 2, 4), session(180_000));
    expect(route.rule).toBe(
      'hard follow-up at 180K → compacted handoff; session moves to Opus 5.5',
    );
    expect(route.sessionChoice).toMatchObject({
      kept: false,
      reason: 'compacted handoff; left the warm Sonnet 5 session (180K context)',
    });
  });

  it('keeps the plain switch wording under the handoff threshold', () => {
    const route = followUp(ratings(4), session(50_000));
    expect(route.rule).toMatch(/^score → top tier/);
    expect(route.sessionChoice?.reason).toMatch(/left the warm Sonnet 5 session \(50K context\)$/);
  });

  it('raises effort on a warm session whose cache survives an effort change', () => {
    const opus = session(180_000, 'opus[1m]', {
      pick: { provider: 'claude', model: 'opus[1m]', modelLabel: 'Opus 5.5', effort: 'medium' },
    });
    const route = followUp(ratings(3), opus);
    expect(route.escalation?.kind).toBe('effort');
    expect(route.pick).toMatchObject({ model: 'opus[1m]', effort: 'high' });
    expect(route.rule).toBe(KEPT_FOR_SESSION);
    expect(route.sessionChoice?.reason).toBe(
      'kept Opus 5.5: warm session, 180K context; effort medium → high (the cache survives an effort change)',
    );
    const easy = followUp(ratings(2), opus);
    expect(easy.escalation?.kind).toBe('stay');
    expect(easy.pick.effort).toBe('medium');
  });

  it('does not raise effort where an effort change would drop the cache', () => {
    const route = followUp(ratings(3), session(180_000));
    expect(route.escalation?.kind).toBe('stay');
    expect(route.pick).toMatchObject({ model: 'sonnet', effort: 'high' });
  });
});

describe('penalty inputs', () => {
  const opus = { id: 'opus[1m]', label: 'Opus 5.5' };

  it('charges only the write-price difference once the warm cache has expired', () => {
    const cold = session(180_000, 'sonnet', { lastUsedAt: new Date(NOW.getTime() - 6 * 60_000) });
    expect(switchCostUsd(cold, opus, NOW)).toBeCloseTo(0.18 * (5 - 2.5), 6);
    const route = followUp(ratings(4), cold);
    expect(route.escalation).toMatchObject({ kind: 'brief', cacheWarm: false });
    expect(route.sessionChoice?.reason).toBe(
      'kept the resumable Sonnet 5 session for later turns (180K context)',
    );
  });

  it('adds the reasoning a switch throws away, at the new model’s output price', () => {
    const thinking = session(48_000, 'sonnet', { reasoningTokens: 10_000 });
    expect(switchCostUsd(thinking, opus, NOW)).toBeCloseTo(0.048 * 4.8 + 0.01 * 20, 6);
    expect(handoffCostUsd(thinking, opus)).toBeCloseTo(0.025 * 5 + 0.01 * 20, 6);
    const capped = session(48_000, 'sonnet', { reasoningTokens: 1_000_000 });
    expect(handoffCostUsd(capped, opus)).toBeCloseTo(0.025 * 5 + 0.032 * 20, 6);
  });

  it('lets a switch that re-reads 400K lose to staying when there is no handoff', () => {
    const route = followUp(ratings(3, 3), session(400_000));
    expect(route.pick.model).toBe('sonnet');
  });
});

describe('no ping-pong', () => {
  const compacted: PriorEscalation = {
    kind: 'compact',
    model: 'opus[1m]',
    modelLabel: 'Opus 5.5',
    unseen: false,
  };
  const briefed: PriorEscalation = { ...compacted, kind: 'brief', unseen: true };

  it('keeps the stronger model after a switch even when the session expired', () => {
    const route = followUp(ratings(1, 1), null, { prior: compacted });
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.rule).toBe('stayed on Opus 5.5: escalated earlier in this task');
  });

  it('never steps the escalated session back down', () => {
    const route = followUp(ratings(1, 1), session(40_000, 'opus[1m]'), { prior: compacted });
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.rule).toBe(KEPT_FOR_SESSION);
  });

  it('sends later hard follow-ups back to the stronger Builder after a brief', () => {
    const route = followUp(ratings(2, 4), session(180_000), { prior: briefed });
    expect(route.escalation).toMatchObject({ kind: 'brief', sticky: true });
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.rule).toBe(
      'hard follow-up at 180K → Opus 5.5 Builder with brief again; Sonnet 5 session kept warm',
    );
  });

  it('keeps routine follow-ups on the warm cheaper session after a brief', () => {
    const route = followUp(ratings(2), session(180_000), { prior: briefed });
    expect(route.escalation?.kind).toBe('stay');
    expect(route.pick.model).toBe('sonnet');
  });
});

describe('absolute rules', () => {
  it('leaves pins, destructive work and an explicit ask for the top model alone', () => {
    const big = session(400_000);
    const pinned = routeBuilder(chat('sonnet', 'pinned'), {
      ...plainFacts,
      ratings: ratings(5, 5),
      session: big,
    });
    expect(pinned).toMatchObject({ routedBy: 'pinned', pick: { model: 'sonnet' } });
    expect(pinned.escalation).toBeUndefined();
    const destructive = followUp(ratings(5, 5), big, { destructive: true });
    expect(destructive.rule).toBe('destructive → top tier');
    expect(destructive.escalation).toBeUndefined();
  });

  it('never resumes or escalates from a fast-tier session', () => {
    const fast: ResumableSession = {
      pick: { provider: 'claude', model: 'haiku', modelLabel: 'Haiku 4.5', effort: 'high' },
      contextTokens: 400_000,
      lastUsedAt: NOW,
    };
    const route = followUp(ratings(4), fast);
    expect(route.escalation).toBeUndefined();
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.sessionChoice).toMatchObject({ kept: false });
  });
});
