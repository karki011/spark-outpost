import { describe, expect, it } from 'vitest';
import { PRICE_TABLE, estimateCostUsd, priceFor, type ModelPrice } from './prices.ts';

const table: ModelPrice[] = [
  {
    provider: 'codex',
    model: 'gpt-test',
    inputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 10,
  },
];

describe('price estimates', () => {
  it('charges cached input at the cached rate and the rest at the input rate', () => {
    const cost = estimateCostUsd(
      'codex',
      'gpt-test',
      { input: 1_000_000, output: 100_000, cachedRead: 400_000 },
      table,
    );
    expect(cost).toBeCloseTo(0.6 * 2 + 0.4 * 0.5 + 0.1 * 10, 6);
  });

  it('treats missing cache counts as uncached input', () => {
    expect(
      estimateCostUsd('codex', 'gpt-test', { input: 500, output: 0, cachedRead: null }, table),
    ).toBe(0.001);
  });

  it('never counts more cached tokens than input tokens', () => {
    expect(
      estimateCostUsd('codex', 'gpt-test', { input: 100, output: 0, cachedRead: 900 }, table),
    ).toBe(0.00005);
  });

  it('rounds to a millionth of a dollar', () => {
    expect(
      estimateCostUsd('codex', 'gpt-test', { input: 1, output: 1, cachedRead: 0 }, table),
    ).toBe(0.000012);
  });

  it('returns null for an unknown model, provider, or no model', () => {
    const tokens = { input: 10, output: 10, cachedRead: 0 };
    expect(estimateCostUsd('codex', 'other', tokens, table)).toBeNull();
    expect(estimateCostUsd('claude', 'gpt-test', tokens, table)).toBeNull();
    expect(estimateCostUsd('codex', null, tokens, table)).toBeNull();
  });

  it('matches a model id that carries an effort suffix', () => {
    expect(priceFor('codex', 'gpt-test/high', table)?.model).toBe('gpt-test');
  });

  it('labels the shipped table as dated estimates', () => {
    expect(PRICE_TABLE.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICE_TABLE.label).toMatch(/estimate/i);
    for (const price of PRICE_TABLE.prices) {
      expect(price.cachedInputPerMillion).toBeLessThanOrEqual(price.inputPerMillion);
      expect(priceFor(price.provider, price.model)).toBe(price);
    }
  });

  it('prices the Codex models from the cited OpenAI price page and nothing else', () => {
    expect(PRICE_TABLE.source).toContain('https://developers.openai.com/api/docs/pricing');
    expect(PRICE_TABLE.prices.map((price) => price.model)).toEqual([
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ]);
    expect(priceFor('codex', 'gpt-6-sol')).toMatchObject({
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 10,
    });
    const tokens = { input: 1000, output: 1000, cachedRead: 0 };
    expect(estimateCostUsd('codex', 'gpt-reserve', tokens)).toBeNull();
    expect(estimateCostUsd('codex', 'codex-auto-review', tokens)).toBeNull();
    expect(estimateCostUsd('claude', 'sonnet', tokens)).toBeNull();
  });
});
