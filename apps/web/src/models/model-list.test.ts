import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCard, ModelCardView, ModelStat } from '@spark-outpost/contracts';
import {
  ALL_PROVIDERS,
  benchmarkHeadline,
  effortRange,
  readSavedProvider,
  retirementNote,
  shortPrice,
  shownProvider,
  sortModels,
  tierNote,
  writeSavedProvider,
} from './model-list.ts';

const card = (overrides: Partial<ModelCard>): ModelCard => ({
  provider: 'claude',
  id: 'claude-sonnet-5',
  label: 'Sonnet 5',
  match: { ids: [], labels: [] },
  tier: 'mid',
  price: {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.2,
    cacheWritePerMillion: null,
    outputPerMillion: 10,
    note: '',
  },
  contextTokens: 200_000,
  maxOutputTokens: 64_000,
  speed: 'fast',
  reasoning: {
    mode: 'effort',
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    note: '',
  },
  strengths: [],
  weakSpots: [],
  blurb: 'b',
  knowledgeCutoff: '2026-01',
  retiresNotBefore: null,
  sources: [{ url: 'x', checkedAt: '2026-09-01' }],
  ...overrides,
});

const stat = (overrides: Partial<ModelStat>): ModelStat => ({
  source: 'benchmark',
  round: 'baseline',
  measuredOn: '2026-09-26',
  file: 'f.json',
  provider: 'claude',
  model: 'claude-sonnet-5',
  agentModel: 'sonnet',
  effort: 'medium',
  role: 'direct',
  category: 'fix',
  n: 4,
  passed: 3,
  meanCostUsd: 0.1,
  costSource: 'reported',
  meanWallMs: 20_000,
  sharedCredit: 0,
  ...overrides,
});

const view = (cardOverrides: Partial<ModelCard>, stats: ModelStat[] = []): ModelCardView => ({
  card: card(cardOverrides),
  offered: true,
  isDefault: false,
  staleness: { checkedDaysAgo: 1, checkStale: false, factsExpired: false, retiring: false },
  jevText: '',
  stats,
});

describe('model list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sorts by tier, price or speed, falling back to tier and putting unpriced models last', () => {
    const models = [
      view({ id: 'top', tier: 'top', speed: 'moderate' }),
      view({ id: 'free', tier: 'frontier', price: null, speed: 'fastest' }),
      view({
        id: 'small',
        tier: 'small',
        price: { ...card({}).price!, inputPerMillion: 1, outputPerMillion: 5 },
      }),
    ];
    const ids = (sort: 'tier' | 'price' | 'speed') =>
      sortModels(models, sort).map((model) => model.card.id);
    expect(ids('tier')).toEqual(['small', 'top', 'free']);
    expect(ids('price')).toEqual(['small', 'top', 'free']);
    expect(ids('speed')).toEqual(['free', 'small', 'top']);
  });

  it('writes compact price and effort facts', () => {
    expect(shortPrice(card({}))).toBe('$2 / $10 per M');
    expect(shortPrice(card({ price: null }))).toBe('No price listed');
    expect(effortRange(card({}))).toBe('low–high');
    expect(effortRange(card({ reasoning: { ...card({}).reasoning, efforts: [] } }))).toBe('none');
  });

  it('notes that the harness skips the small tier and runs on the middle one', () => {
    expect(tierNote('small')).toMatch(/harness never picks it/);
    expect(tierNote('mid')).toMatch(/Scouts, answers, Critics and everyday Builders/);
    expect(tierNote('frontier')).toMatch(/never pick it/);
  });

  it('headlines the best pass rate with its mean cost and flags thin evidence', () => {
    expect(benchmarkHeadline(view({}))).toBeNull();
    const headline = benchmarkHeadline(
      view({}, [
        stat({}),
        stat({ category: 'plan', role: 'architect', n: 2, passed: 2, meanCostUsd: 0.25 }),
      ]),
    );
    expect(headline).toEqual({
      text: 'Best 2/2 passed, $0.250 mean · plan as Architect · medium',
      anecdotal: true,
    });
  });

  it('shows upcoming retirement dates and tags a retiring model as unused by the harness', () => {
    expect(retirementNote(view({}))).toBeNull();
    expect(retirementNote(view({ retiresNotBefore: '2027-06-30' }))).toBe('Retires 2027-06-30');
    const retiring = { ...view({ retiresNotBefore: '2026-10-15' }) };
    retiring.staleness = { ...retiring.staleness, retiring: true };
    expect(retirementNote(retiring)).toBe('Retiring 2026-10-15 · not used by the harness');
  });

  it('remembers the provider filter and falls back to all when storage or provider is gone', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    expect(readSavedProvider()).toBe(ALL_PROVIDERS);
    writeSavedProvider('codex');
    expect(readSavedProvider()).toBe('codex');
    expect(shownProvider('codex', ['claude', 'codex'])).toBe('codex');
    expect(shownProvider('gone', ['claude', 'codex'])).toBe(ALL_PROVIDERS);

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readSavedProvider()).toBe(ALL_PROVIDERS);
    expect(() => writeSavedProvider('claude')).not.toThrow();
  });
});
