import { describe, expect, it } from 'vitest';
import { categoryFromKeyword, matchesFilter, parseChatFilter } from './category-filter.ts';

describe('chat filter', () => {
  it('reads an is: category and keeps the rest as search text', () => {
    expect(parseChatFilter('  is:debugging date divider ')).toEqual({
      text: 'date divider',
      category: 'debugging',
      unknownCategory: null,
    });
    expect(parseChatFilter('release notes')).toEqual({
      text: 'release notes',
      category: null,
      unknownCategory: null,
    });
  });

  it('accepts ids, labels and short aliases in any case', () => {
    expect(categoryFromKeyword('bug_fix')).toBe('bug_fix');
    expect(categoryFromKeyword('Bug-fix')).toBe('bug_fix');
    expect(categoryFromKeyword('bugfix')).toBe('bug_fix');
    expect(categoryFromKeyword('DEBUG')).toBe('debugging');
    expect(categoryFromKeyword('config')).toBe('setup');
    expect(categoryFromKeyword('reading')).toBe('research');
  });

  it('matches nothing for an unknown category, and ignores a bare is:', () => {
    const unknown = parseChatFilter('is:deploys');
    expect(unknown).toMatchObject({ category: null, unknownCategory: 'deploys' });
    expect(matchesFilter(unknown, 'feature')).toBe(false);
    expect(parseChatFilter('is:')).toEqual({ text: '', category: null, unknownCategory: null });
  });

  it('lets the last is: win and matches only chats in that category', () => {
    const filter = parseChatFilter('is:docs is:refactor');
    expect(filter.category).toBe('refactor');
    expect(matchesFilter(filter, 'refactor')).toBe(true);
    expect(matchesFilter(filter, null)).toBe(false);
    expect(matchesFilter(parseChatFilter('plain'), null)).toBe(true);
  });
});
