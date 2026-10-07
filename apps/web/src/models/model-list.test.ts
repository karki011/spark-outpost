import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCard, ModelCardView, ModelStat } from '@spark-outpost/contracts';
import {
  ALL_PROVIDERS,
  benchmarkBadge,
  contextLine,
  effortRange,
  fullPrice,
  groupModels,
  knowledgeMonth,
  modelFacts,
  nextSort,
  orderModels,
  priceCells,
  readSavedProvider,
  purposeLine,
  retirementDetail,
  retirementTag,
  roleLine,
  shownProvider,
  staleNote,
  usedBySpark,
  writeSavedProvider,
  type ModelSort,
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

  it('groups the models Spark picks apart from the ones only you pick', () => {
    const retiring = view({ id: 'old', tier: 'top' });
    retiring.staleness = { ...retiring.staleness, retiring: true };
    const groups = groupModels([
      view({ id: 'frontier', tier: 'frontier' }),
      retiring,
      view({ id: 'top', tier: 'top' }),
      view({ id: 'mid', tier: 'mid' }),
    ]);
    expect(
      groups.map((group) => [group.title, group.models.map((model) => model.card.id)]),
    ).toEqual([
      ['Spark picks from these', ['mid', 'top']],
      ['Only when you pick it', ['old', 'frontier']],
    ]);
    expect(groupModels([view({ tier: 'small' })]).map((group) => group.id)).toEqual(['manual']);
  });

  it('gives each row one line of purpose: the job Spark uses it for, else its first strength', () => {
    expect(purposeLine(view({}))).toBe('Everyday Builder, Critic, answers');
    expect(purposeLine(view({ tier: 'small', strengths: ['Cheap and fast', 'Other'] }))).toBe(
      'Cheap and fast',
    );
    expect(purposeLine(view({ tier: 'small' }))).toBeNull();
  });

  it('sorts inside each group, keeps models without a price last, and cycles back to the default order', () => {
    const price = (inputPerMillion: number, outputPerMillion: number) => ({
      ...card({}).price!,
      inputPerMillion,
      outputPerMillion,
    });
    const models = [
      view({ id: 'mid-cheap', tier: 'mid', price: price(1, 9) }),
      view({ id: 'top', tier: 'top', price: price(4, 20) }),
      view({ id: 'mid-dear', tier: 'mid', price: price(3, 5) }),
      view({ id: 'small-free', tier: 'small', price: null }),
      view({ id: 'small', tier: 'small', price: price(0.1, 0.5) }),
    ];
    const ids = (sort: ModelSort | null) =>
      groupModels(models, sort).map((group) => group.models.map((model) => model.card.id));
    expect(ids(null)).toEqual([
      ['mid-cheap', 'mid-dear', 'top'],
      ['small-free', 'small'],
    ]);
    expect(ids({ key: 'output', direction: 'ascending' })).toEqual([
      ['mid-dear', 'mid-cheap', 'top'],
      ['small', 'small-free'],
    ]);
    expect(ids({ key: 'input', direction: 'descending' })).toEqual([
      ['top', 'mid-dear', 'mid-cheap'],
      ['small', 'small-free'],
    ]);
    expect(ids({ key: 'tier', direction: 'descending' })[0]).toEqual([
      'top',
      'mid-cheap',
      'mid-dear',
    ]);
    const ascending = nextSort(null, 'output');
    expect(ascending).toEqual({ key: 'output', direction: 'ascending' });
    expect(nextSort(ascending, 'output')).toEqual({ key: 'output', direction: 'descending' });
    expect(nextSort(nextSort(ascending, 'output'), 'output')).toBeNull();
    expect(nextSort(ascending, 'tier')).toEqual({ key: 'tier', direction: 'ascending' });
  });

  it('fills the table cells and shows a dash for what a card does not say', () => {
    expect(priceCells(card({}))).toEqual(['$2', '$0.2', '$10']);
    expect(priceCells(card({ price: null }))).toEqual(['—', '—', '—']);
    expect(contextLine(card({}))).toBe('200K / 64K');
    expect(knowledgeMonth(card({ knowledgeCutoff: '2026-05-18' }))).toBe('2026-05');
    expect(knowledgeMonth(card({ knowledgeCutoff: 'not documented' }))).toBe('—');
  });

  it('lists the secondary facts for the details panel', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(modelFacts(card({ retiresNotBefore: '2027-06-30' }), now)).toEqual([
      ['Tier', 'mid'],
      ['Price', '$2 in · $0.2 cached · $10 out per million tokens'],
      ['Context', '200K · 64K max output'],
      ['Speed', 'fast'],
      ['Effort', 'low–high (default medium)'],
      ['Knowledge', '2026-01'],
      ['Retirement', 'Retires 2027-06-30'],
    ]);
    expect(fullPrice(card({ price: null }))).toBe('No price listed');
    expect(modelFacts(card({}), now).map(([label]) => label)).not.toContain('Retirement');
    expect(effortRange(card({}))).toBe('low–high');
    expect(effortRange(card({ reasoning: { ...card({}).reasoning, efforts: [] } }))).toBe('none');
  });

  it('notes stale facts briefly on the row and in full in the details', () => {
    expect(staleNote(view({}))).toBeNull();
    const stale = view({});
    stale.staleness = { ...stale.staleness, checkStale: true, checkedDaysAgo: 40 };
    expect(staleNote(stale)).toEqual({
      short: 'Checked 40 days ago',
      full: 'Checked 40 days ago',
    });
    stale.staleness = { ...stale.staleness, factsExpired: true };
    expect(staleNote(stale)).toEqual({
      short: 'Facts out of date',
      full: 'Facts are over 120 days old: Jev no longer sees its price',
    });
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
      ratio: '2/2',
      text: '2/2 passed',
      detail: 'Best at plan as Architect · medium, $0.250 mean',
      anecdotal: true,
    });
  });

  it('tags a retirement only when it is near', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(retirementTag(view({}), now)).toBeNull();
    expect(retirementTag(view({ retiresNotBefore: '2027-06-30' }), now)).toBeNull();
    expect(retirementTag(view({ retiresNotBefore: '2026-12-01' }), now)).toBe('Retiring Dec 1');
    expect(
      retirementTag(view({ tier: 'frontier', retiresNotBefore: '2027-09-01' }), now),
    ).toBeNull();
    expect(retirementTag(view({ tier: 'small', retiresNotBefore: '2026-10-15' }), now)).toBe(
      'Retiring Oct 15',
    );
    expect(retirementTag(view({ retiresNotBefore: '2027-01-10' }), Date.parse('2026-12-01'))).toBe(
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
    expect(retirementTag(view(haiku), Date.parse('2026-10-15T23:00:00Z'))).toBe('Retiring Oct 15');
    expect(retirementTag(view(haiku), after)).toBe('Retired Oct 15');
    expect(retirementDetail(card(haiku), after)).toBe('Retired 2026-10-15');
    const marked = { retiresNotBefore: '2026-11-01', retired: true };
    expect(retirementTag(view(marked), Date.parse('2026-09-28T12:00:00Z'))).toBe('Retired Nov 1');
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
