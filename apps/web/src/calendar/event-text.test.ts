import { describe, expect, it } from 'vitest';
import { peopleLine } from './event-text.ts';

describe('peopleLine', () => {
  it('names one or two people, then counts the rest', () => {
    expect(peopleLine(['Alex W'], 2)).toBe('Alex W');
    expect(peopleLine(['Alex W', 'Ivan M'], 3)).toBe('Alex W and Ivan M');
    expect(peopleLine(['Julia K', 'Ivan M', 'Sam', 'Lee'], 5)).toBe('Julia K, Ivan M +2 more');
  });

  it('falls back to a count without names, and says nothing for one person', () => {
    expect(peopleLine([], 4)).toBe('4 people');
    expect(peopleLine([], 1)).toBeNull();
  });
});
