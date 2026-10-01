import { describe, expect, it } from 'vitest';
import type { ModelTier } from '@spark-outpost/contracts';
import { routeBuilder } from '../orchestration/routing.ts';
import { context, plainFacts } from '../orchestration/route-fixtures.ts';
import { demotions, demotionText, recentRecords, type BuilderOutcome } from './demotion.ts';
import { demotedRates, demotionNote, withDemotion } from './demotion-route.ts';

const TIERS: Record<string, [string, ModelTier]> = {
  sonnet: ['Sonnet 5', 'mid'],
  'gpt-6-sol': ['6 Sol', 'mid'],
  haiku: ['Haiku 4.5', 'small'],
};

const info = (_provider: string, model: string) => {
  const [label, tier] = TIERS[model] ?? [model, null];
  return { label, tier };
};

function outcomes(
  model: string,
  passed: number,
  failed: number,
  kind = 'bug_fix',
  provider = model.startsWith('gpt') ? 'codex' : 'claude',
): BuilderOutcome[] {
  return [
    ...Array.from({ length: failed }, () => ({ provider, model, kind, passed: false })),
    ...Array.from({ length: passed }, () => ({ provider, model, kind, passed: true })),
  ];
}

const demoted = (rows: BuilderOutcome[]) => demotions(recentRecords(rows, info));

describe('Peter principle demotions', () => {
  it('demotes a model whose recent pass rate falls below its tier peers by the margin', () => {
    const list = demoted([...outcomes('sonnet', 11, 9), ...outcomes('gpt-6-sol', 18, 2)]);
    expect(list.map((entry) => [entry.model, entry.passed, entry.runs])).toEqual([
      ['sonnet', 11, 20],
    ]);
    expect(demotionText(list[0]!)).toBe(
      'Sonnet 5 has passed 55% of recent bug fixes here (11/20; its mid tier peers 90%)',
    );
  });

  it('needs ten runs, keeps kinds apart and uses only the last twenty', () => {
    expect(demoted(outcomes('sonnet', 2, 7))).toEqual([]);
    expect(
      demoted([...outcomes('sonnet', 2, 8, 'feature'), ...outcomes('gpt-6-sol', 20, 0)]),
    ).toHaveLength(1);
    const recovered = [
      ...Array.from({ length: 20 }, () => ({
        provider: 'claude',
        model: 'sonnet',
        kind: 'bug_fix',
        passed: true,
      })),
      ...outcomes('sonnet', 0, 20),
    ];
    expect(demoted(recovered)).toEqual([]);
  });

  it('uses a floor when no tier peer has enough runs', () => {
    expect(demoted(outcomes('sonnet', 5, 5)).map((entry) => entry.bar)).toEqual([0.6]);
    expect(demoted(outcomes('sonnet', 7, 3))).toEqual([]);
  });

  it('routes a demoted chat model elsewhere and says why', () => {
    const list = demoted(outcomes('sonnet', 5, 7));
    const route = routeBuilder(context('auto'), {
      ...plainFacts,
      demoted: demotedRates(list, 'claude'),
    });
    expect(route.pick.model).not.toBe('sonnet');
    expect(withDemotion(route, list, 'sonnet').note).toContain(
      'Sonnet 5 has passed 42% of recent bug fixes here (5/12; the 60% floor), so Spark routed this work elsewhere',
    );
  });

  it('never overrides a pinned model and only notes it', () => {
    const list = demoted(outcomes('sonnet', 5, 7));
    const route = routeBuilder(context('pinned'), {
      ...plainFacts,
      demoted: demotedRates(list, 'claude'),
    });
    expect(route.pick.model).toBe('sonnet');
    expect(demotionNote(route, list, 'sonnet')).toBe(
      'Sonnet 5 has passed 42% of recent bug fixes here (5/12; the 60% floor); pinned, so Spark kept it',
    );
  });
});
