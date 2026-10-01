import { describe, expect, it } from 'vitest';
import { cardFor } from '../model-cards/cards.ts';
import { pickForDemand, pieceDemand, type Demand } from './piece-demand.ts';
import type { PieceAnswer, RouteOption } from './piece-questions.ts';

function option(
  provider: string,
  model: string,
  label: string,
  tier: RouteOption['tier'],
  passRate: number | null = null,
): RouteOption {
  const card = cardFor({ id: model, label }, provider);
  return {
    id: `${provider}/${model}`,
    provider,
    model,
    label,
    tier,
    passRate,
    strengths: card?.strengths ?? [],
    contextTokens: card?.contextTokens ?? null,
    priceUsd: card?.price ? card.price.inputPerMillion + card.price.outputPerMillion : null,
  };
}

const LIVE_ROUTES = [
  option('claude', 'opus[1m]', 'Opus 5.5', 'top'),
  option('claude', 'sonnet', 'Sonnet 5', 'mid'),
  option('codex', 'gpt-6-sol', '6 Sol', 'mid'),
  option('zai', 'opus', 'GLM-5.3', 'top'),
];

const score = (mean: number, confidence = 0.9) => ({ mean, confidence });

function answer(extra: Partial<PieceAnswer> = {}): PieceAnswer {
  return {
    kind: { choice: 'implement', confidence: 0.9, probabilities: { implement: 0.9 } },
    reasoning: score(2),
    coding: score(2.5),
    context: score(1.5),
    reliability: 0.1,
    wide: null,
    ...extra,
  };
}

const plain = { destructive: false, core: false };

function demandOf(extra: Partial<PieceAnswer>, facts = plain): Demand {
  const result = pieceDemand(answer(extra), facts);
  if (!result.ok) throw new Error(result.reason);
  return result.demand;
}

describe('pieceDemand', () => {
  it('weighs reasoning, coding and context into a tier', () => {
    expect(demandOf({ reasoning: score(1), coding: score(1.5), context: score(1) })).toMatchObject({
      tier: 'low',
      raisedBy: null,
    });
    expect(demandOf({ reasoning: score(3), coding: score(3), context: score(2) })).toMatchObject({
      tier: 'mid',
      signals: 'reasoning 3, coding 3, context 2',
    });
    expect(demandOf({ reasoning: score(3.8), coding: score(3.6), context: score(3.5) }).tier).toBe(
      'top',
    );
  });

  it('leaves out an unsure context score instead of guessing', () => {
    const demand = demandOf({ context: score(5, 0.2) });
    expect(demand.signals).toBe('reasoning 2, coding 2.5');
    expect(demand.score).toBeCloseTo((0.45 * 2 + 0.35 * 2.5) / 0.8);
  });

  it.each([
    ['destructive', answer(), { destructive: true, core: false }, 'top'],
    [
      'data migration',
      answer({ kind: { choice: 'migrate', confidence: 0.8, probabilities: {} } }),
      plain,
      'top',
    ],
    ['must be right first time', answer({ reliability: 0.7 }), plain, 'top'],
    [
      'deep reasoning',
      answer({ reasoning: score(4.2), coding: score(1), context: score(1) }),
      plain,
      'top',
    ],
    [
      'core refactor',
      answer({
        kind: { choice: 'refactor', confidence: 0.8, probabilities: {} },
        reasoning: score(1),
        coding: score(1),
      }),
      { destructive: false, core: true },
      'mid',
    ],
  ] as const)('raises the tier for %s', (why, given, facts, tier) => {
    const result = pieceDemand(given, facts);
    expect(result).toMatchObject({ ok: true, demand: { tier, raisedBy: why } });
  });

  it('still sends an unsure piece to the top tier when a floor demands it (live run D, P1)', () => {
    const migration = answer({
      kind: { choice: 'migrate', confidence: 1, probabilities: { migrate: 1 } },
      reasoning: score(2.24, 0.49),
      coding: score(1.89, 0.9),
      context: score(2.01, 0.98),
      reliability: 0.66,
    });
    expect(pieceDemand(migration, { destructive: true, core: null })).toMatchObject({
      ok: true,
      demand: {
        tier: 'top',
        raisedBy: 'destructive',
        signals: 'coding 1.9, context 2, high stakes',
      },
    });
    expect(pieceDemand({ ...migration, kind: 'missing-answer', reliability: 0.1 }, plain)).toEqual({
      ok: false,
      reason: 'Jev was unsure (reasoning 0.49)',
    });
  });

  it('ignores a task kind Jev is unsure of', () => {
    const unsureKind = answer({ kind: { choice: 'migrate', confidence: 0.3, probabilities: {} } });
    expect(pieceDemand(unsureKind, plain)).toMatchObject({ ok: true, demand: { kind: null } });
  });

  it.each([
    [{ reasoning: score(3, 0.3) }, 'Jev was unsure (reasoning 0.30)'],
    [{ coding: null }, 'Jev gave no coding'],
  ])('falls back to the rules when a core signal is unsure', (extra, reason) => {
    expect(pieceDemand(answer(extra), plain)).toEqual({ ok: false, reason });
  });

  it('names the capability that clearly leads', () => {
    expect(demandOf({ reasoning: score(4), coding: score(2.5) }).capability).toBe('reasoning');
    expect(demandOf({ reasoning: score(2), coding: score(3.5) }).capability).toBe('coding');
    expect(demandOf({ reasoning: score(3), coding: score(3.2) }).capability).toBe('balanced');
  });
});

describe('pickForDemand', () => {
  const mid = (extra: Partial<Demand> = {}): Demand => ({
    score: 3,
    tier: 'mid',
    capability: 'balanced',
    kind: 'implement',
    signals: '',
    raisedBy: null,
    ...extra,
  });

  it('prefers the clearly better measured pass rate', () => {
    const routes = [
      option('claude', 'sonnet', 'Sonnet 5', 'mid', 0.6),
      option('codex', 'gpt-6-sol', '6 Sol', 'mid', 0.85),
    ];
    expect(pickForDemand(mid(), routes, 'claude')).toMatchObject({
      route: { id: 'codex/gpt-6-sol' },
      why: 'best pass rate',
    });
  });

  it('uses model-card strengths for the capability the piece needs', () => {
    expect(pickForDemand(mid({ capability: 'reasoning' }), LIVE_ROUTES, 'claude')).toMatchObject({
      route: { id: 'codex/gpt-6-sol' },
      why: 'strong at reasoning',
    });
  });

  it("breaks a tie between equal routes with the chat's provider", () => {
    expect(pickForDemand(mid(), LIVE_ROUTES, 'claude')).toMatchObject({
      route: { id: 'claude/sonnet' },
      why: "the chat's provider",
    });
  });

  it('takes the cheaper route of a mid tier when nothing else separates them', () => {
    const routes = [
      { ...option('claude', 'sonnet', 'Sonnet 5', 'mid'), priceUsd: 3 },
      { ...option('codex', 'gpt-6-sol', '6 Sol', 'mid'), priceUsd: 2 },
    ];
    expect(pickForDemand(mid(), routes, 'claude')).toMatchObject({
      route: { id: 'codex/gpt-6-sol' },
      why: 'cheapest',
    });
  });

  it("keeps the chat's provider over a cheaper route at the top tier", () => {
    expect(pickForDemand(mid({ tier: 'top' }), LIVE_ROUTES, 'claude')).toMatchObject({
      route: { id: 'claude/opus[1m]' },
      why: "the chat's provider",
    });
    expect(pickForDemand(mid({ tier: 'top' }), LIVE_ROUTES, 'codex')).toMatchObject({
      route: { id: 'zai/opus' },
      why: 'cheapest',
    });
  });

  it('steps up a tier when none is left at the demanded one, and never down', () => {
    expect(pickForDemand(mid({ tier: 'low' }), LIVE_ROUTES, 'claude')!.route.tier).toBe('mid');
    const topOnly = LIVE_ROUTES.filter((route) => route.tier === 'top');
    expect(pickForDemand(mid(), topOnly, 'claude')!.route.tier).toBe('top');
    const midOnly = LIVE_ROUTES.filter((route) => route.tier === 'mid');
    expect(pickForDemand(mid({ tier: 'top' }), midOnly, 'claude')).toBeNull();
  });
});
