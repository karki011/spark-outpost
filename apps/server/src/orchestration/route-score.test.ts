import { describe, expect, it } from 'vitest';
import type { AgentPick, ModelStat, Ratings } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import type { ResumableSession } from './cache-switch.ts';
import { candidates, plainFacts } from './route-fixtures.ts';
import { failureRate, scoreText } from './route-score.ts';
import { routeBuilder, type RouteContext, type RouteFacts } from './routing.ts';
import { KEPT_FOR_SESSION } from './session-keep.ts';
import { ruleSignals } from './task-signals.ts';

const NOW = new Date('2026-09-30T12:00:00Z');

const LABELS: Record<string, string> = {
  haiku: 'Haiku 4.5',
  sonnet: 'Sonnet 5',
  'opus[1m]': 'Opus 5.5',
};

function chat(model: string, routing: 'auto' | 'pinned' = 'auto'): RouteContext {
  return {
    routing,
    chat: { provider: 'claude', model, modelLabel: LABELS[model]!, effort: 'medium' },
    providerEffort: null,
    candidates,
    request: 'update the report view',
    now: NOW,
  };
}

const rated = (value: number) => ({ value, confidence: 0.9 });

function ratings(complexity: number, stakes = 2, ambiguity = 2, context = 2): Ratings {
  return {
    complexity: rated(complexity),
    stakes: rated(stakes),
    ambiguity: rated(ambiguity),
    contextDependence: rated(context),
  };
}

function withRatings(values: Ratings, extra: Partial<RouteFacts> = {}): RouteFacts {
  return { ...plainFacts, ratings: values, ...extra };
}

function session(model: string, contextTokens: number, idleMs = 60_000): ResumableSession {
  const pick: AgentPick = {
    provider: 'claude',
    model,
    modelLabel: LABELS[model]!,
    effort: 'high',
  };
  return { pick, contextTokens, lastUsedAt: new Date(NOW.getTime() - idleMs) };
}

describe('quality minus cost', () => {
  it('sends easy work to the cheaper model that is just as likely to pass', () => {
    const route = routeBuilder(chat('opus[1m]'), withRatings(ratings(1, 1)));
    expect(route.pick.model).toBe('sonnet');
    expect(route.rule).toBe(
      'simple → mid tier (complexity 1 (Jev), ambiguity 2 (Jev), stakes 1 (Jev), context 2 (Jev))',
    );
    expect(route.score?.ranked.map((model) => model.id)).toEqual(['sonnet', 'opus[1m]']);
  });

  it('keeps the chat model for everyday work when a cheaper one would pass less often', () => {
    expect(routeBuilder(chat('opus[1m]'), withRatings(ratings(2))).pick.model).toBe('opus[1m]');
    expect(routeBuilder(chat('sonnet'), withRatings(ratings(3, 3))).pick.model).toBe('sonnet');
  });

  it('moves hard or high-stakes work to the stronger model', () => {
    const hard = routeBuilder(chat('sonnet'), withRatings(ratings(4)));
    expect(hard).toMatchObject({ pick: { model: 'opus[1m]' } });
    expect(hard.rule).toMatch(/^score → top tier \(complexity 4 \(Jev\)/);
    expect(routeBuilder(chat('sonnet'), withRatings(ratings(3, 5))).pick.model).toBe('opus[1m]');
    expect(routeBuilder(chat('sonnet'), withRatings(ratings(3, 4))).pick.model).toBe('sonnet');
  });

  it('shrinks the cost weight as stakes rise', () => {
    const low = routeBuilder(chat('sonnet'), withRatings(ratings(3, 2))).score!;
    const high = routeBuilder(chat('sonnet'), withRatings(ratings(3, 4))).score!;
    expect(high.repairUsd).toBeGreaterThan(low.repairUsd);
  });

  it('never scores a fast-tier model, however cheap', () => {
    const route = routeBuilder(chat('haiku'), withRatings(ratings(1, 1)));
    expect(route.pick.model).toBe('sonnet');
    expect(route.score?.ranked.map((model) => model.id)).not.toContain('haiku');
  });

  it("keeps a pinned chat's Builder on the pin whatever Jev rates the work", () => {
    const hard = routeBuilder(chat('sonnet', 'pinned'), withRatings(ratings(5, 5)));
    expect(hard).toMatchObject({ routedBy: 'pinned', rule: 'pinned', pick: { model: 'sonnet' } });
    expect(hard.score).toBeUndefined();
    const simple = routeBuilder(chat('opus[1m]', 'pinned'), withRatings(ratings(1, 1)));
    expect(simple).toMatchObject({ routedBy: 'pinned', pick: { model: 'opus[1m]' } });
    expect(simple.score).toBeUndefined();
  });

  it('leaves destructive work to the rules', () => {
    const destructive = routeBuilder(
      chat('opus[1m]'),
      withRatings(ratings(1, 1), { destructive: true }),
    );
    expect(destructive).toMatchObject({ rule: 'destructive → top tier' });
    expect(destructive.score).toBeUndefined();
  });

  it('matches the rules without Jev', () => {
    expect(routeBuilder(chat('opus[1m]'), { ...plainFacts, trivial: true })).toMatchObject({
      rule: 'trivial → middle tier',
      pick: { model: 'sonnet' },
    });
    expect(routeBuilder(chat('sonnet'), plainFacts)).toMatchObject({
      rule: 'chat model',
      pick: { model: 'sonnet' },
    });
  });

  it('lets measured failures lower a model’s expected quality', () => {
    const sonnet = cardFor({ id: 'sonnet', label: 'Sonnet 5' }, 'claude')!;
    const signals = ruleSignals({ trivial: false, destructive: false, complex: null });
    const stat: ModelStat = {
      source: 'benchmark',
      round: 'r',
      measuredOn: '2026-09-27',
      file: 'f.json',
      provider: 'claude',
      model: sonnet.id,
      agentModel: 'sonnet',
      effort: 'medium',
      role: 'builder',
      category: 'fix',
      n: 22,
      passed: 18,
      meanCostUsd: 0.1,
      costSource: 'reported',
      meanWallMs: 1,
      sharedCredit: 0,
    };
    expect(failureRate(sonnet, signals, [], NOW)).toBeCloseTo(0.0045, 6);
    expect(failureRate(sonnet, signals, [stat], NOW)).toBeGreaterThan(0.05);
    expect(failureRate(sonnet, signals, [{ ...stat, n: 5, passed: 4 }], NOW)).toBeCloseTo(
      0.0045,
      6,
    );
  });

  it('ranks by expected dollars: token cost plus the failure rate times the repair cost', () => {
    const score = routeBuilder(chat('sonnet'), withRatings(ratings(2))).score!;
    for (const model of score.ranked) {
      expect(model.expectedUsd).toBeCloseTo(model.costUsd + (1 - model.quality) * 10, 9);
      expect(model.utility).toBe(-model.expectedUsd);
    }
    expect(score.ranked[0]!.expectedUsd).toBeLessThanOrEqual(score.ranked[1]!.expectedUsd);
  });

  it('explains the pick with the signals and the top scores', () => {
    const score = routeBuilder(chat('sonnet'), withRatings(ratings(2))).score!;
    expect(scoreText(score)).toMatch(
      /^score complexity 2 \(Jev\), ambiguity 2 \(Jev\), stakes 2 \(Jev\), context 2 \(Jev\); repair \$10\.00; expected cost incl\. repair: Sonnet 5 \$0\.11 \(q 0\.99\d, \$0\.07 tokens\), Opus 5\.5 \$0\.16 \(q 0\.99\d, \$0\.12 tokens\)$/,
    );
  });
});

describe('the warm session', () => {
  it('keeps the session model for a follow-up the chat model would take', () => {
    const route = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(2), { session: session('opus[1m]', 48_000) }),
    );
    expect(route).toMatchObject({
      pick: { model: 'opus[1m]', effort: 'high' },
      rule: KEPT_FOR_SESSION,
    });
    expect(route.sessionChoice).toMatchObject({
      kept: true,
      reason: 'kept Opus 5.5: warm session, 48K context',
    });
  });

  it('never steps down from the session, even for easy work', () => {
    const route = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(1, 1), { session: session('opus[1m]', 2_000) }),
    );
    expect(route.pick.model).toBe('opus[1m]');
  });

  it('steps up when the stronger model is worth more than re-reading the context', () => {
    const route = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(4), { session: session('sonnet', 20_000) }),
    );
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.sessionChoice).toMatchObject({ kept: false });
    expect(route.sessionChoice?.reason).toMatch(/left the warm Sonnet 5 session \(20K context\)$/);
    const opus = route.score!.ranked.find((model) => model.id === 'opus[1m]')!;
    expect(opus.switchUsd).toBeCloseTo(0.02 * (5 - 0.2), 6);
  });

  it('stays when the context is large enough that switching costs more than it gains', () => {
    const route = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(3, 3), { session: session('sonnet', 400_000) }),
    );
    expect(route).toMatchObject({ pick: { model: 'sonnet' }, rule: KEPT_FOR_SESSION });
    expect(route.sessionChoice?.reason).toBe('kept Sonnet 5: warm session, 400K context');
  });

  it('hands a hard follow-up at 400K to the stronger model through a brief instead', () => {
    const route = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(4), { session: session('sonnet', 400_000) }),
    );
    expect(route.pick.model).toBe('opus[1m]');
    expect(route.escalation?.kind).toBe('brief');
  });

  it('does not resume a fast-tier session or one on another provider', () => {
    const fast = routeBuilder(
      chat('sonnet'),
      withRatings(ratings(2), { session: session('haiku', 20_000) }),
    );
    expect(fast.pick.model).toBe('sonnet');
    expect(fast.sessionChoice).toMatchObject({ kept: false });
    const other: ResumableSession = {
      pick: { provider: 'codex', model: 'gpt-6-sol', modelLabel: '6 Sol', effort: 'high' },
      contextTokens: 20_000,
    };
    const route = routeBuilder(chat('sonnet'), withRatings(ratings(2), { session: other }));
    expect(route.pick.model).toBe('sonnet');
    expect(route.sessionChoice).toBeUndefined();
  });
});

describe('Sonnet 5.5 as the mid tier', () => {
  const listed: RouteContext = {
    ...chat('opus[1m]'),
    candidates: candidates.map((candidate) =>
      candidate.provider === 'claude'
        ? {
            ...candidate,
            models: candidate.models.map((model) =>
              model.id === 'sonnet' ? { ...model, label: 'Sonnet 5.5' } : model,
            ),
          }
        : candidate,
    ),
  };

  it('is scored from its own card, so Auto sends easy work to it', () => {
    const route = routeBuilder(listed, withRatings(ratings(1, 1)));
    expect(route.pick).toMatchObject({ model: 'sonnet', modelLabel: 'Sonnet 5.5' });
    expect(route.routedBy).not.toBe('pinned');
    expect(route.score?.ranked.map((model) => model.id)).toEqual(['sonnet', 'opus[1m]']);
  });

  it('stays out of the way of a pinned chat', () => {
    const route = routeBuilder({ ...listed, routing: 'pinned' }, plainFacts);
    expect(route.pick.model).toBe('opus[1m]');
    expect(route).toMatchObject({ routedBy: 'pinned', rule: 'pinned' });
  });
});
