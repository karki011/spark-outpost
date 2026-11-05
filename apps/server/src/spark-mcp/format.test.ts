import { describe, expect, it } from 'vitest';
import { page, renderResult } from './format.ts';

describe('renderResult', () => {
  it('redacts secrets in values and secret-named fields', () => {
    const text = renderResult({
      note: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here',
      apiKey: 'plain-value',
      inputTokens: 12,
    });
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(text).not.toContain('plain-value');
    expect(JSON.parse(text)).toMatchObject({ inputTokens: 12 });
  });

  it('shortens long lists and texts until the result fits, saying how much was left out', () => {
    const big = {
      items: Array.from({ length: 500 }, (_, index) => `item ${index} ${'x'.repeat(200)}`),
    };
    const text = renderResult(big, 5_000);
    expect(text.length).toBeLessThanOrEqual(5_000);
    const parsed = JSON.parse(text) as { items: string[] };
    expect(parsed.items.at(-1)).toMatch(/^… \d+ more$/);
  });

  it('drops undefined fields and keeps small results as they are', () => {
    expect(renderResult({ a: 1, b: undefined, c: [1, 2] })).toBe('{"a":1,"c":[1,2]}');
  });
});

describe('page', () => {
  it('returns the slice with the next offset only when more remain', () => {
    expect(page([1, 2, 3], 0, 2)).toEqual({ total: 3, offset: 0, items: [1, 2], nextOffset: 2 });
    expect(page([1, 2, 3], 2, 2)).toEqual({ total: 3, offset: 2, items: [3] });
  });
});
