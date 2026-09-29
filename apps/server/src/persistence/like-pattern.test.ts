import { describe, expect, it } from 'vitest';
import { containsPattern } from './like-pattern.ts';

describe('containsPattern', () => {
  it('matches the text anywhere and treats LIKE wildcards and backslashes literally', () => {
    expect(containsPattern('zoom')).toBe('%zoom%');
    expect(containsPattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%');
  });
});
