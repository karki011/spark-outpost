import { describe, expect, it } from 'vitest';
import { modelTier, tierInfo, tierLadder } from './tiers.ts';

const HAIKU = { id: 'haiku', label: 'Haiku 4.5' };
const SONNET = { id: 'sonnet', label: 'Sonnet 5' };
const OPUS = { id: 'opus[1m]', label: 'Opus 5.5' };

describe('model tiers', () => {
  it('reads the tier from the card, then from the name, then gives none', () => {
    expect(tierInfo(SONNET, 'claude')).toEqual({ tier: 1, source: 'card' });
    expect(tierInfo({ id: 'sonnet', label: 'Sonnet 9' }, 'claude')).toEqual({
      tier: 1,
      source: 'pattern',
    });
    expect(tierInfo({ id: 'mystery', label: 'Mystery' })).toEqual({ tier: null, source: 'none' });
  });

  it('ranks the tier', () => {
    expect(modelTier(HAIKU, 'claude')).toBe(0);
    expect(modelTier({ id: 'mystery', label: 'Mystery' }, 'claude')).toBeNull();
  });

  it('orders one model per tier, lowest first', () => {
    expect(tierLadder([OPUS, HAIKU, SONNET], 'claude')).toEqual([HAIKU, SONNET, OPUS]);
    expect(tierLadder([], 'claude')).toEqual([]);
  });
});
