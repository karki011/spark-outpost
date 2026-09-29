import { describe, expect, it } from 'vitest';
import type { RoutingLabelRow } from '../persistence/routing-labels.ts';
import { atK, toLabel } from './labels.ts';

describe('file prediction at k', () => {
  it('counts hits in the first five predictions against the files that changed', () => {
    expect(atK(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'f', 'g'])).toEqual({
      hits: 1,
      precision: 0.2,
      recall: 1 / 3,
    });
  });

  it('uses the predictions available when there are fewer than five', () => {
    expect(atK(['a', 'b'], ['b'])).toEqual({ hits: 1, precision: 0.5, recall: 1 });
  });

  it('has no ratio without predictions or changes', () => {
    expect(atK([], ['a'])).toEqual({ hits: 0, precision: null, recall: 0 });
    expect(atK(['a'], [])).toEqual({ hits: 0, precision: 0, recall: null });
  });
});

describe('routing labels from stored rows', () => {
  const row = (fields: Partial<Record<keyof RoutingLabelRow, unknown>>) =>
    ({
      created_at: new Date('2026-09-01T00:00:00Z'),
      jev_cost_usd: 0,
      ...fields,
    }) as RoutingLabelRow;

  it('reads well-formed picks and variants', () => {
    const label = toLabel(
      row({
        rule_route: { pick: { provider: 'claude', model: 'claude-sonnet-5' }, rule: 'chat model' },
        builder_route: { provider: 'claude', model: 'm', modelLabel: 'Sonnet 5' },
        jev_text: { status: 'answered', confidence: 0.8, pick: { provider: 'codex', model: 'x' } },
      }),
    );
    expect(label.rule).toEqual({ pick: 'claude-sonnet-5', rule: 'chat model' });
    expect(label.builder).toBe('Sonnet 5');
    expect(label.jevText).toMatchObject({ status: 'answered', confidence: 0.8, pick: 'x' });
  });

  it('drops malformed stored values instead of passing them on', () => {
    const label = toLabel(
      row({
        rule_route: 'garbage',
        builder_route: { provider: 5, model: ['m'] },
        tier_pick: [1, 2],
        jev_text: { status: 3, confidence: 'high', selection: 'x', pick: { model: 7 } },
        jev_evidence: 'nope',
      }),
    );
    expect(label.rule).toEqual({ pick: null, rule: null });
    expect(label.builder).toBeNull();
    expect(label.tierPick).toBeNull();
    expect(label.jevText).toEqual({
      status: null,
      pick: null,
      runs: null,
      choice: null,
      confidence: null,
      basis: null,
      tier: null,
      routeProbability: null,
      latencyMs: null,
      tokens: null,
      costUsd: null,
    });
    expect(label.jevEvidence).toBeNull();
  });
});
