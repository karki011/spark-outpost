import { describe, expect, it } from 'vitest';
import { findMention, removeMention } from './mention.ts';

describe('findMention', () => {
  it('finds an @ query that ends at the caret', () => {
    expect(findMention('look at @src/app', 16)).toEqual({ start: 8, end: 16, query: 'src/app' });
  });

  it('opens on a bare @ at the start of the message', () => {
    expect(findMention('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('ignores @ inside a word such as an email address', () => {
    expect(findMention('mail sam@example.com', 20)).toBeNull();
  });

  it('closes once the caret moves past a space', () => {
    expect(findMention('@readme then', 12)).toBeNull();
  });
});

describe('removeMention', () => {
  it('drops the @ query and keeps the text around it', () => {
    const text = 'check @read please';
    const mention = findMention(text, 11);
    expect(mention).not.toBeNull();
    expect(removeMention(text, mention!)).toBe('check  please');
  });
});
