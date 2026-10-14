import { describe, expect, it } from 'vitest';
import { createAnsweredQueryFilter } from './answered-queries.ts';

const QUERIES = [
  '\x1b[c',
  '\x1b[0c',
  '\x1b[>c',
  '\x1b[>0c',
  '\x1b[5n',
  '\x1b[6n',
  '\x1b[?996n',
  '\x1b[?2026$p',
  '\x1b[4$p',
  '\x1b[>q',
  '\x1b[>0q',
  '\x1b]10;?\x07',
  '\x1b]10;?\x1b\\',
  '\x1b]11;?\x07',
  '\x1b]11;?\x1b\\',
];

const KEPT = [
  '\x1b[?2031h',
  '\x1b[?25l',
  '\x1b[38;5;196m',
  '\x1b[2J',
  '\x1b[?u',
  '\x1b]4;1;?\x07',
  '\x1b]12;?\x07',
  '\x1b]11;#101010\x07',
  '\x1b]0;title\x07',
  '\x1b]8;;https://example.com\x1b\\',
];

describe('createAnsweredQueryFilter', () => {
  it.each(QUERIES)('drops %j, which tmux answers itself', (query) => {
    expect(createAnsweredQueryFilter()(`before${query}after`)).toBe('beforeafter');
  });

  it.each(KEPT)('passes %j on to the terminal', (sequence) => {
    expect(createAnsweredQueryFilter()(`before${sequence}after`)).toBe(`before${sequence}after`);
  });

  it.each(QUERIES)('drops %j when it arrives in pieces', (query) => {
    for (let cut = 1; cut < query.length; cut += 1) {
      const filter = createAnsweredQueryFilter();
      const shown = filter(`a${query.slice(0, cut)}`) + filter(`${query.slice(cut)}b`);
      expect(shown).toBe('ab');
    }
  });

  it.each(KEPT)('passes %j on unchanged when it arrives in pieces', (sequence) => {
    for (let cut = 1; cut < sequence.length; cut += 1) {
      const filter = createAnsweredQueryFilter();
      const shown = filter(`a${sequence.slice(0, cut)}`) + filter(`${sequence.slice(cut)}b`);
      expect(shown).toBe(`a${sequence}b`);
    }
  });

  it('shows text at once when nothing in it could start a query', () => {
    const filter = createAnsweredQueryFilter();
    expect(filter('plain \x1b[31mred\x1b[0m text')).toBe('plain \x1b[31mred\x1b[0m text');
  });
});
