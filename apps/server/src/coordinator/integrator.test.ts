import { describe, expect, it } from 'vitest';
import { integratorModel, type IntegratorFacts } from './integrator.ts';

const sonnet = (key: string, owns: string[]) => ({
  key,
  provider: 'claude',
  model: 'sonnet',
  owns,
});

const C2: IntegratorFacts = {
  pieces: [
    sonnet('P1', ['src/csv-export.ts', 'test/csv-export.test.ts']),
    sonnet('P2', ['src/rate-limit.ts', 'test/rate-limit.test.ts']),
    sonnet('P3', ['README.md']),
  ],
  topTier: new Set(),
  work: 'fix',
  findings: ['`src/rate-limit.ts:20` allows the first request when `limit` is 0.'],
};

describe('integratorModel', () => {
  it('follows the model every piece used so the fix turn reads from the cache', () => {
    expect(integratorModel(C2)).toEqual({
      follow: { provider: 'claude', model: 'sonnet' },
      reason: '3 of 3 pieces ran on this model; same model keeps the cache',
    });
  });

  it('follows the model most pieces used', () => {
    const mixed = {
      ...C2,
      pieces: [...C2.pieces, { key: 'P4', provider: 'codex', model: 'gpt-6-sol', owns: [] }],
    };
    expect(integratorModel(mixed).follow).toEqual({ provider: 'claude', model: 'sonnet' });
  });

  it('keeps the seat model when no model has most of the pieces', () => {
    const split = {
      ...C2,
      pieces: [
        { key: 'P1', provider: 'claude', model: 'opus[1m]', owns: ['migrations/002.sql'] },
        sonnet('P2', ['src/slug.ts']),
      ],
    };
    expect(integratorModel(split)).toEqual({
      follow: null,
      reason: 'the pieces used different models',
    });
  });

  it('keeps the seat model to reconcile a merge conflict', () => {
    expect(integratorModel({ ...C2, work: 'conflict' })).toEqual({
      follow: null,
      reason: 'a merge conflict across pieces',
    });
  });

  it('keeps the seat model when findings touch a high-stakes piece', () => {
    const stakes = { ...C2, topTier: new Set(['P2']) };
    expect(integratorModel(stakes)).toEqual({
      follow: null,
      reason: 'Critic findings touch high-stakes P2',
    });
    expect(integratorModel({ ...stakes, topTier: new Set(['P1']) }).follow).not.toBeNull();
    expect(integratorModel({ ...stakes, findings: ['Something is off.'] }).follow).toBeNull();
    expect(integratorModel({ ...stakes, work: 'glue' }).follow).not.toBeNull();
  });
});
