import { describe, expect, it } from 'vitest';
import { measuredSeedSchema, vendorCardsFileSchema } from '@spark-outpost/contracts';
import seedJson from './measured-seed.json' with { type: 'json' };
import vendorJson from './vendor-cards.json' with { type: 'json' };
import { cardFor, effectiveDefaultModel, usableDefault, VENDOR_CARDS } from './cards.ts';
import { modelTier, oneTierUp, tierInfo, tierLadder, topTier } from '../orchestration/tiers.ts';

const claude = [
  { id: 'default', label: 'Default (recommended)' },
  { id: 'opus[1m]', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' },
  { id: 'sonnet', label: 'Sonnet 5' },
  { id: 'haiku', label: 'Haiku 4.5' },
];
const codex = [
  { id: 'gpt-6-astra', label: '6 Astra' },
  { id: 'gpt-6-sol', label: '6 Sol' },
  { id: 'gpt-6-luna', label: '6 Luna' },
];
const zai = [
  { id: 'opus', label: 'GLM-5.3' },
  { id: 'haiku', label: 'GLM-5.3-Flash' },
];

describe('card files', () => {
  it('parse against the contract schemas', () => {
    expect(vendorCardsFileSchema.safeParse(vendorJson).success).toBe(true);
    expect(measuredSeedSchema.safeParse(seedJson).success).toBe(true);
  });

  it('give every card a unique id, a unique label and a checked source', () => {
    const ids = VENDOR_CARDS.cards.map((card) => card.id);
    const labels = VENDOR_CARDS.cards.flatMap((card) => card.match.labels);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(VENDOR_CARDS.providers.map((card) => card.provider)).toEqual(['claude', 'codex', 'zai']);
  });
});

describe('tiers from cards', () => {
  it('ranks by card: Fable and 6 Astra are frontier, GPT-5.6 Sol is top', () => {
    expect(modelTier({ id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' })).toBe(3);
    expect(modelTier({ id: 'gpt-6-astra', label: '6 Astra' })).toBe(3);
    expect(modelTier({ id: 'gpt-5.6-sol', label: '' })).toBe(2);
    expect(tierInfo({ id: 'sonnet', label: 'Sonnet 5' })).toEqual({ tier: 1, source: 'card' });
  });

  it('matches the provider: a Z.ai slot named opus is GLM-5.3, not Opus 5.5', () => {
    expect(cardFor({ id: 'opus', label: 'GLM-5.3' }, 'zai')?.id).toBe('glm-5.3');
    expect(cardFor({ id: 'opus', label: 'GLM-5.3' }, 'claude')).toBeNull();
    expect(cardFor({ id: 'opus[1m]', label: 'Opus 5.5' }, 'claude')?.id).toBe('claude-opus-5-5');
  });

  it('treats a changed label as no card and falls back to the name pattern', () => {
    expect(cardFor({ id: 'sonnet', label: 'Sonnet 5.5' }, 'claude')).toBeNull();
    expect(tierInfo({ id: 'sonnet', label: 'Sonnet 5.5' }, 'claude')).toEqual({
      tier: 1,
      source: 'pattern',
    });
    expect(tierInfo({ id: 'mystery', label: 'Mystery' })).toEqual({ tier: null, source: 'none' });
  });

  it('keeps frontier models off the ladder, so Opus stays top and Codex tops out at 6 Sol', () => {
    expect(tierLadder(claude, 'claude').map((model) => model.id)).toEqual([
      'haiku',
      'sonnet',
      'opus[1m]',
    ]);
    expect(topTier(claude, 'claude')?.id).toBe('opus[1m]');
    expect(tierLadder(codex, 'codex').map((model) => model.id)).toEqual([
      'gpt-6-luna',
      'gpt-6-sol',
    ]);
    expect(oneTierUp(codex, 'gpt-6-sol', 'codex')).toBeNull();
    expect(oneTierUp(claude, 'opus[1m]', 'claude')).toBeNull();
    expect(tierLadder(zai, 'zai').map((model) => model.label)).toEqual([
      'GLM-5.3-Flash',
      'GLM-5.3',
    ]);
  });
});

describe('effective default model', () => {
  it('uses 6 Sol for Codex instead of the adapter default, 6 Astra', () => {
    expect(effectiveDefaultModel('codex', codex, 'gpt-6-astra')).toBe('gpt-6-sol');
  });

  it('starts Claude on Opus 5.5 whatever the adapter defaults to', () => {
    expect(effectiveDefaultModel('claude', claude, 'default')).toBe('opus[1m]');
    expect(effectiveDefaultModel('claude', claude, 'sonnet')).toBe('opus[1m]');
  });

  it('never defaults to a retiring model', () => {
    const today = new Date('2026-09-28T00:00:00Z');
    expect(effectiveDefaultModel('claude', claude, 'haiku', today)).toBe('opus[1m]');
    expect(effectiveDefaultModel('claude', [], 'haiku', today)).toBe('haiku');
    const earlier = new Date('2026-08-01T00:00:00Z');
    expect(effectiveDefaultModel('claude', claude, 'haiku', earlier)).toBe('opus[1m]');
    const onlyRetiring = [{ id: 'gpt-5.5', label: 'GPT-5.5' }, ...codex];
    expect(effectiveDefaultModel('codex', onlyRetiring, 'gpt-5.5', today)).toBe('gpt-6-sol');
    expect(usableDefault('claude', 'haiku', today)).toBeNull();
    expect(usableDefault('claude', 'sonnet', today)).toBe('sonnet');
    expect(usableDefault('zai', 'haiku', today)).toBe('haiku');
    expect(usableDefault('claude', null, today)).toBeNull();
  });

  it('replaces a frontier adapter default with the top non-frontier model', () => {
    expect(effectiveDefaultModel('claude', claude, 'claude-fable-5-1[1m]')).toBe('opus[1m]');
  });

  it('keeps the adapter default when the everyday model is not offered or nothing has a card', () => {
    const astraOnly = [{ id: 'gpt-6-astra', label: '6 Astra' }];
    expect(effectiveDefaultModel('codex', astraOnly, 'gpt-6-astra')).toBe('gpt-6-astra');
    expect(effectiveDefaultModel('codex', [{ id: 'x', label: 'X' }], 'x')).toBe('x');
    expect(effectiveDefaultModel('zai', zai, 'opus')).toBe('opus');
  });
});
