import { describe, expect, it } from 'vitest';
import { CARD_CATEGORIES, JEV_CARD_CHARACTERS, type ModelStat } from '@spark-outpost/contracts';
import { cardById, VENDOR_CARDS } from './cards.ts';
import {
  cardText,
  effortNote,
  fitPieces,
  providerText,
  staleness,
  statFor,
  usableStats,
} from './card-text.ts';
import { MEASURED_SEED } from './ingest.ts';

const now = new Date('2026-09-27T12:00:00Z');
const sonnet = cardById('claude-sonnet-5')!;
const opus = cardById('claude-opus-5-5')!;
const haiku = cardById('claude-haiku-4-5')!;

const stat = (overrides: Partial<ModelStat>): ModelStat => ({
  source: 'benchmark',
  round: 'r',
  measuredOn: '2026-09-26',
  file: 'f.json',
  provider: 'claude',
  model: 'claude-sonnet-5',
  agentModel: 'sonnet',
  effort: 'medium',
  role: 'builder',
  category: 'fix',
  n: 3,
  passed: 3,
  meanCostUsd: 0.09,
  costSource: 'reported',
  meanWallMs: 29_000,
  sharedCredit: 0,
  ...overrides,
});

describe('card text for Jev', () => {
  it('reads label, tier, speed, price, blurb and one measured stat', () => {
    const stats = MEASURED_SEED.stats;
    expect(cardText(sonnet, statFor(stats, sonnet, 'fix'), now)).toBe(
      'Sonnet 5: mid tier, fast, $2/$10 per M; everyday coding and agentic tool use; bench fix 24/24 ~$0.08 27s',
    );
    expect(cardText(opus, statFor(stats, opus, 'plan'), now)).toBe(
      'Opus 5.5: top tier, moderate, $4/$20 per M; long agentic coding, large refactors, planning; bench plan 10/10 ~$0.17 37s',
    );
  });

  it('stays within 160 characters for every card and category, even with a long stat', () => {
    const big = (card: typeof sonnet) =>
      CARD_CATEGORIES.map((category) =>
        stat({
          model: card.id,
          provider: card.provider,
          category,
          role: category === 'plan' ? 'architect' : 'builder',
          n: 99_999,
          passed: 99_999,
          meanCostUsd: 123.45,
          meanWallMs: 9_999_999,
        }),
      );
    for (const card of VENDOR_CARDS.cards) {
      for (const category of [...CARD_CATEGORIES, null]) {
        const text = cardText(card, statFor(big(card), card, category), now);
        expect(text.length).toBeLessThanOrEqual(JEV_CARD_CHARACTERS);
        expect(text.startsWith(`${card.label}: ${card.tier} tier`)).toBe(true);
      }
    }
  });

  it('hides stats with fewer than 3 samples, older than 90 days, or for the wrong role', () => {
    expect(statFor([stat({ n: 2, passed: 2 })], sonnet, 'fix')).toBeNull();
    expect(statFor([stat({ role: 'architect' })], sonnet, 'fix')).toBeNull();
    expect(usableStats([stat({ measuredOn: '2026-05-01' })], now)).toEqual([]);
    expect(
      statFor([stat({}), stat({ category: 'feature', n: 5, passed: 4 })], sonnet, null),
    ).toMatchObject({
      category: 'feature',
      n: 5,
    });
  });

  it('drops price and blurb once the vendor facts are older than 120 days', () => {
    const later = new Date('2027-02-01T00:00:00Z');
    expect(staleness(sonnet, later)).toMatchObject({ checkStale: true, factsExpired: true });
    expect(cardText(sonnet, null, later)).toBe('Sonnet 5: mid tier, fast');
  });

  it('marks a retiring model', () => {
    const afterRetirement = new Date('2026-10-20T00:00:00Z');
    expect(staleness(haiku, afterRetirement).retiring).toBe(true);
    expect(cardText(haiku, null, afterRetirement)).toMatch(/; retiring$/);
  });

  it('describes providers within the budget, reflecting whether Do is available', () => {
    for (const card of VENDOR_CARDS.providers) {
      for (const doAvailable of [true, false]) {
        expect(providerText(card, doAvailable).length).toBeLessThanOrEqual(JEV_CARD_CHARACTERS);
      }
    }
    const codex = VENDOR_CARDS.providers.find((card) => card.provider === 'codex')!;
    expect(providerText(codex, false)).toMatch(
      /^Codex: read-only here \(no Do\); good independent reviewer/,
    );
    expect(providerText(codex, true)).toMatch(
      /^Codex: can edit \(Do\), asks only outside its sandbox/,
    );
  });

  it('notes default efforts and models without an effort setting', () => {
    expect(effortNote([opus, sonnet, haiku])).toBe(
      'Defaults: Opus 5.5 medium, Sonnet 5 high; Haiku 4.5 has no effort setting',
    );
    expect(effortNote(VENDOR_CARDS.cards).length).toBeLessThanOrEqual(JEV_CARD_CHARACTERS);
  });

  it('never cuts a piece in half', () => {
    expect(fitPieces('a'.repeat(150), ['b'.repeat(20), 'c'])).toBe(`${'a'.repeat(150)}; c`);
  });
});
