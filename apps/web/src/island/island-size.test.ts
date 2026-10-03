import { describe, expect, it } from 'vitest';
import { restMetrics } from './island-size.ts';

describe('island size', () => {
  it('keeps the small island at its original resting shape', () => {
    expect(restMetrics('small')).toEqual({
      blob: 38,
      tuck: 20,
      pillHeight: 34,
      pillScout: 22,
      pillInset: 48,
      pillWing: 40,
    });
  });

  it('grows the blob, its tuck and the needs-you pill together', () => {
    const medium = restMetrics('medium');
    const large = restMetrics('large');
    expect([medium.blob, large.blob]).toEqual([48, 58]);
    expect(medium.blob - medium.tuck).toBeGreaterThan(18);
    expect(large.pillHeight).toBeGreaterThan(medium.pillHeight);
    expect(medium.pillInset - medium.pillScout).toBe(26);
  });
});
