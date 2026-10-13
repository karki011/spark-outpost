import { describe, expect, it } from 'vitest';
import { ISLAND_SIZES, restMetrics } from './island-size.ts';

describe('island size', () => {
  it('keeps the small island at its original resting shape', () => {
    expect(restMetrics('small')).toEqual({ blob: 38, tuck: 20, reach: 14 });
  });

  it('grows the blob and its tuck together', () => {
    const medium = restMetrics('medium');
    const large = restMetrics('large');
    expect([medium.blob, large.blob]).toEqual([48, 58]);
    expect(medium.blob - medium.tuck).toBeGreaterThan(18);
    expect(large.tuck).toBeGreaterThan(medium.tuck);
  });

  it('offers Extra large last, at twice the Large blob', () => {
    expect(ISLAND_SIZES.map((size) => size.label)).toEqual([
      'Full',
      'Small',
      'Medium',
      'Large',
      'Extra large',
    ]);
    const large = restMetrics('large');
    const extra = restMetrics('xlarge');
    expect(extra.blob).toBe(2 * large.blob);
    expect(extra.tuck).toBe(61);
    expect(extra.blob - extra.tuck).toBe(55);
  });
});
