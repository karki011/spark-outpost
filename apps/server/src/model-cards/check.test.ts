import { describe, expect, it } from 'vitest';
import type { VendorCardsFile } from '@spark-outpost/contracts';
import { VENDOR_CARDS } from './cards.ts';
import { checkModelCards } from './check.ts';

const TODAY = new Date('2026-09-29T12:00:00Z');

function checkedOn(day: string): VendorCardsFile {
  const recheck = <T extends { sources: { url: string; checkedAt: string }[] }>(card: T): T => ({
    ...card,
    sources: card.sources.map((source) => ({ ...source, checkedAt: day })),
  });
  return {
    ...VENDOR_CARDS,
    providers: VENDOR_CARDS.providers.map(recheck),
    cards: VENDOR_CARDS.cards.map((card) => ({ ...recheck(card), retiresNotBefore: null })),
  };
}

function markRetired(file: VendorCardsFile, ids: readonly string[]): VendorCardsFile {
  return {
    ...file,
    cards: file.cards.map((card) => (ids.includes(card.id) ? { ...card, retired: true } : card)),
  };
}

describe('checkModelCards', () => {
  it('passes the shipped cards today', () => {
    expect(checkModelCards(VENDOR_CARDS, TODAY)).toEqual({ warnings: [], failures: [] });
  });

  it('warns once a source is over 60 days old', () => {
    expect(checkModelCards(checkedOn('2026-07-31'), TODAY).warnings).toEqual([]);
    const result = checkModelCards(checkedOn('2026-07-30'), TODAY);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(
        /^claude-sonnet-5: checked 61 days ago, over 60: https:\/\/platform\.claude\.com\/\S+ \(2026-07-30\)/,
      ),
    );
  });

  it('fails once a source is over 120 days old', () => {
    const result = checkModelCards(checkedOn('2026-05-01'), TODAY);
    expect(result.warnings).toEqual([]);
    expect(result.failures.length).toBe(VENDOR_CARDS.providers.length + VENDOR_CARDS.cards.length);
    expect(result.failures[0]).toMatch(/^provider claude: checked 151 days ago, over 120: /);
  });

  it('fails the day after a retirement date until the card is marked retired', () => {
    const onTheDay = checkModelCards(VENDOR_CARDS, new Date('2026-10-15T23:00:00Z'));
    expect(onTheDay.failures).toEqual([
      'gpt-5.5: retired on 2026-10-14; set "retired": true on its card and move defaults off it',
    ]);
    const after = new Date('2026-10-16T00:00:00Z');
    expect(checkModelCards(VENDOR_CARDS, after).failures.map((line) => line.split(':')[0])).toEqual(
      ['claude-haiku-4-5', 'gpt-5.5'],
    );
    const marked = markRetired(VENDOR_CARDS, ['claude-haiku-4-5', 'gpt-5.5']);
    expect(checkModelCards(marked, after)).toEqual({ warnings: [], failures: [] });
  });
});
