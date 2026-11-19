import { describe, expect, it } from 'vitest';
import type { ModelCard, PromptCacheLast } from '@spark-outpost/contracts';
import { modelSwitchNote, switchesModel, uncachedUsd } from './model-switch-cache.ts';

const card = (id: string, label: string, write: number | null, input = 5): ModelCard =>
  ({
    provider: 'claude',
    id,
    label,
    match: { ids: [id], labels: [label] },
    price: {
      inputPerMillion: input,
      cachedInputPerMillion: input / 10,
      cacheWritePerMillion: write,
      outputPerMillion: input * 5,
      note: '',
    },
  }) as ModelCard;

const CARDS = [
  card('claude-opus-5-5', 'Opus 5.5', 6.25),
  card('claude-sonnet-5-5', 'Sonnet 5.5', 3.75, 3),
];
const NOW = Date.parse('2026-11-18T10:00:00Z');

const last = (extra: Partial<PromptCacheLast> = {}): PromptCacheLast => ({
  at: '2026-11-18T09:58:00Z',
  contextTokens: 182_000,
  ttlSeconds: 300,
  rewriteUsd: 1.14,
  expired: null,
  estimateBy: 'spark',
  ...extra,
});

const opus = { provider: 'claude', model: 'opus', used: 'claude-opus-5-5' };
const sonnet = { provider: 'claude', model: 'sonnet', label: 'Sonnet 5.5' };

describe('modelSwitchNote', () => {
  it('prices the re-send at the new model’s cache-write rate while the cache is warm', () => {
    expect(modelSwitchNote(last(), opus, sonnet, CARDS, NOW)).toEqual({
      key: 'claude:sonnet:2026-11-18T09:58:00Z',
      text: 'Next message re-sends ~182K tokens uncached (≈$0.68)',
    });
  });

  it('says nothing for a cold or unknown cache, the same model or another provider', () => {
    expect(modelSwitchNote(last({ expired: true }), opus, sonnet, CARDS, NOW)).toBeNull();
    expect(modelSwitchNote(last({ ttlSeconds: null }), opus, sonnet, CARDS, NOW)).toBeNull();
    expect(modelSwitchNote(null, opus, sonnet, CARDS, NOW)).toBeNull();
    const sameCard = { provider: 'claude', model: 'opus', label: 'Opus 5.5' };
    expect(modelSwitchNote(last(), opus, sameCard, CARDS, NOW)).toBeNull();
    expect(modelSwitchNote(last(), opus, { ...sonnet, provider: 'codex' }, CARDS, NOW)).toBeNull();
  });

  it('gives tokens alone when the new model has no price', () => {
    const note = modelSwitchNote(last(), opus, { provider: 'claude', model: 'mystery' }, [], NOW);
    expect(note?.text).toBe('Next message re-sends ~182K tokens uncached');
  });
});

describe('switchesModel', () => {
  it('compares cards when both are known, and the picked ids otherwise', () => {
    expect(switchesModel(opus, { provider: 'claude', model: 'claude-opus-5-5' }, CARDS)).toBe(
      false,
    );
    expect(
      switchesModel({ provider: 'claude', model: 'a' }, { provider: 'claude', model: 'b' }, []),
    ).toBe(true);
    expect(
      switchesModel(
        { provider: 'claude', model: 'a' },
        { provider: 'claude', model: 'default' },
        [],
      ),
    ).toBe(false);
    expect(switchesModel(null, sonnet, CARDS)).toBe(false);
  });
});

describe('uncachedUsd', () => {
  it('uses twice the input price for the one-hour cache and the input price with no write price', () => {
    expect(uncachedUsd(CARDS[0]!, 1_000_000, 3600)).toBe(10);
    expect(uncachedUsd(card('x', 'X', null, 2), 1_000_000, 300)).toBe(2);
    expect(uncachedUsd(null, 1_000_000, 300)).toBeNull();
  });
});
