import { describe, expect, it } from 'vitest';
import type { RouterTier } from '../advisor/policy.ts';
import type { RouteCandidate } from './candidates.ts';
import { selectRoute } from './select-route.ts';

function candidate(tier: RouterTier, model = 'test'): RouteCandidate {
  return { id: `p/${model}-${tier}`, provider: 'p', model: `${model}-${tier}`, label: tier, tier };
}

const mid = candidate('mid');
const top = candidate('top');

function answer(choice: string, confidence: number, probabilities: Record<string, number>) {
  return { choice, confidence, probabilities };
}

describe('route acceptance (pi-model-router rule)', () => {
  it('takes the top option at confidence 0.65 or more', () => {
    const selected = selectRoute(
      answer(mid.id, 0.85, { [mid.id]: 0.9, [top.id]: 0.05, uncertain: 0.05 }),
      [mid, top],
      'mid',
    );
    expect(selected).toEqual({ basis: 'choice', candidate: mid, routeProbability: 0.9 });
  });

  it('uses the full distribution to pick a conservative route when confidence is low', () => {
    const selected = selectRoute(
      answer(mid.id, 0.1, { [mid.id]: 0.4, [top.id]: 0.3, uncertain: 0.3 }),
      [mid, top],
      'mid',
    );
    expect(selected).toEqual({ basis: 'probability', candidate: top, routeProbability: 1 });
  });

  it('accepts a lower route only when cumulative probability clears 0.8', () => {
    const selected = selectRoute(
      answer(mid.id, 0.1, { [mid.id]: 0.85, [top.id]: 0.1, uncertain: 0.05 }),
      [mid, top],
      'mid',
    );
    expect(selected.basis).toBe('probability');
    expect(selected.candidate).toBe(mid);
    expect(selected.routeProbability).toBeCloseTo(0.9);
  });

  it('sends an uncertain answer to the chat model', () => {
    const selected = selectRoute(
      answer('uncertain', 0.85, { [mid.id]: 0.05, [top.id]: 0.05, uncertain: 0.9 }),
      [mid, top],
      'mid',
    );
    expect(selected).toEqual({ basis: 'uncertain', candidate: null, routeProbability: 0.9 });
  });

  it.each([
    { tiers: ['low', 'mid'], baseline: 'top', mass: [0.2, 0.45, 0.35], selected: null },
    { tiers: ['low', 'mid'], baseline: 'top', mass: [0.85, 0.05, 0.1], selected: 'low' },
    { tiers: ['low', 'mid'], baseline: 'micro', mass: [0.45, 0.2, 0.35], selected: 'low' },
    { tiers: ['low', 'top'], baseline: 'mid', mass: [0.2, 0.45, 0.35], selected: 'top' },
    { tiers: ['low', 'top'], baseline: 'mid', mass: [0.45, 0.2, 0.35], selected: null },
    {
      tiers: ['low', 'mid'],
      baseline: 'top',
      mass: [0.33, 0.33, 0.33],
      selected: null,
      threshold: 1,
    },
  ] as const)(
    'keeps abstention at the baseline $baseline for $tiers and $mass',
    ({ tiers, baseline, mass, selected, ...options }) => {
      const routes = tiers.map((tier) => candidate(tier));
      const selection = selectRoute(
        answer(routes[mass[0] >= mass[1] ? 0 : 1]!.id, 0.1, {
          [routes[0]!.id]: mass[0],
          [routes[1]!.id]: mass[1],
          uncertain: mass[2],
        }),
        routes,
        baseline,
        { confidence: 0.65, mass: 'threshold' in options ? options.threshold : 0.8 },
      );
      expect(selection.candidate?.tier ?? null).toBe(selected);
      expect(selection.basis).toBe(selected ? 'probability' : 'uncertain');
    },
  );

  it('picks the most likely model inside a tier and counts the whole tier', () => {
    const sonnet = candidate('mid', 'sonnet');
    const sol = candidate('mid', 'sol');
    const haiku = candidate('low', 'haiku');
    const selection = selectRoute(
      answer(haiku.id, 0.2, { [haiku.id]: 0.4, [sonnet.id]: 0.25, [sol.id]: 0.3, uncertain: 0.05 }),
      [haiku, sonnet, sol],
      'mid',
    );
    expect(selection.candidate).toBe(sol);
    expect(selection.routeProbability).toBeCloseTo(1);
  });
});
