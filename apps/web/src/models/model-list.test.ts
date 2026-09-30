import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCard, ModelCardView, ModelStat } from '@spark-outpost/contracts';
import {
  ALL_PROVIDERS,
  benchmarkBadge,
  effortRange,
  metaLine,
  modelTag,
  orderModels,
  readSavedProvider,
  retirementDetail,
  roleLine,
  shortPrice,
  shownProvider,
  usedBySpark,
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
  staleness: {
    checkedDaysAgo: 1,
    checkStale: false,
    factsExpired: false,
    retiring: false,
    retired: false,
  },
  jevText: '',
  stats,
});

describe('model list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the tiers Spark uses first and the ones it never picks last, in tier order', () => {
    const retiring = view({ id: 'old', tier: 'top' });
    retiring.staleness = { ...retiring.staleness, retiring: true };
    const models = [
      view({ id: 'frontier', tier: 'frontier' }),
      retiring,
      view({ id: 'top', tier: 'top' }),
      view({ id: 'small', tier: 'small' }),
      view({ id: 'mid', tier: 'mid' }),
    ];
    expect(orderModels(models).map((model) => model.card.id)).toEqual([
      'mid',
      'top',
      'small',
      'old',
      'frontier',
    ]);
    expect(usedBySpark(retiring)).toBe(false);
    expect(roleLine(retiring)).toBeNull();
    expect(roleLine(view({}))).toBe('Everyday Builder, Critic, answers');
    expect(roleLine(view({ tier: 'top' }))).toBe('Complex and risky work');
    expect(roleLine(view({ tier: 'small' }))).toBeNull();
  });

  it('writes a compact meta line and effort range', () => {
    expect(metaLine(card({}))).toEqual(['$2 / $10', '200K context', 'fast']);
    expect(shortPrice(card({ price: null }))).toBe('No price listed');
    expect(effortRange(card({}))).toBe('low–high');
    expect(effortRange(card({ reasoning: { ...card({}).reasoning, efforts: [] } }))).toBe('none');
  });

  it('badges the best pass rate and keeps the cost and work for its tooltip', () => {
    expect(benchmarkBadge(view({}))).toBeNull();
    const badge = benchmarkBadge(
      view({}, [
        stat({}),
        stat({ category: 'plan', role: 'architect', n: 2, passed: 2, meanCostUsd: 0.25 }),
      ]),
    );
    expect(badge).toEqual({
      text: '2/2 passed',
      detail: 'Best at plan as Architect · medium, $0.250 mean',
      anecdotal: true,
    });
  });

  it('tags a model Spark never picks and shows a retirement only when it is near', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(modelTag(view({}), now)).toBeNull();
    expect(modelTag(view({ retiresNotBefore: '2027-06-30' }), now)).toBeNull();
    expect(modelTag(view({ retiresNotBefore: '2026-12-01' }), now)).toBe('Retiring Dec 1');
    expect(modelTag(view({ tier: 'frontier', retiresNotBefore: '2027-09-01' }), now)).toBe(
      'Only when you pick it',
    );
    expect(modelTag(view({ tier: 'small', retiresNotBefore: '2026-10-15' }), now)).toBe(
      'Retiring Oct 15',
    );
    expect(modelTag(view({ retiresNotBefore: '2027-01-10' }), Date.parse('2026-12-01'))).toBe(
      'Retiring Jan 10, 2027',
    );
    expect(retirementDetail(card({ retiresNotBefore: '2027-06-30' }), now)).toBe(
      'Retires 2027-06-30',
    );
    expect(retirementDetail(card({}), now)).toBeNull();
  });

  it('says retired once the date has passed or the card is marked retired', () => {
    const after = Date.parse('2026-10-16T00:00:00Z');
    const haiku = { tier: 'small' as const, retiresNotBefore: '2026-10-15' };
    expect(modelTag(view(haiku), Date.parse('2026-10-15T23:00:00Z'))).toBe('Retiring Oct 15');
    expect(modelTag(view(haiku), after)).toBe('Retired Oct 15');
    expect(retirementDetail(card(haiku), after)).toBe('Retired 2026-10-15');
    const marked = { retiresNotBefore: '2026-11-01', retired: true };
    expect(modelTag(view(marked), Date.parse('2026-09-28T12:00:00Z'))).toBe('Retired Nov 1');
    expect(retirementDetail(card({ retired: true }), after)).toBe('Retired');
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
