import { describe, expect, it } from 'vitest';
import {
  categoryFromKeyword,
  matchesFilter,
  matchesTeammate,
  parseChatFilter,
  withTeammateToken,
} from './category-filter.ts';

describe('chat filter', () => {
  it('reads an is: category and keeps the rest as search text', () => {
    expect(parseChatFilter('  is:research date divider ')).toEqual({
      text: 'date divider',
      category: 'research',
      unknownCategory: null,
      teammate: null,
    });
    expect(parseChatFilter('release notes')).toEqual({
      text: 'release notes',
      category: null,
      unknownCategory: null,
      teammate: null,
    });
  });

  it('accepts ids, labels and short aliases in any case', () => {
    expect(categoryFromKeyword('bug_fix')).toBe('bug_fix');
    expect(categoryFromKeyword('Bug-fix')).toBe('bug_fix');
    expect(categoryFromKeyword('bugfix')).toBe('bug_fix');
    expect(categoryFromKeyword('DEBUG')).toBe('bug_fix');
    expect(categoryFromKeyword('setup')).toBe('config');
    expect(categoryFromKeyword('chore')).toBe('config');
    expect(categoryFromKeyword('Tests')).toBe('tests');
    expect(categoryFromKeyword('reading')).toBe('research');
  });

  it('matches nothing for an unknown category, and ignores a bare is:', () => {
    const unknown = parseChatFilter('is:deploys');
    expect(unknown).toMatchObject({ category: null, unknownCategory: 'deploys' });
    expect(matchesFilter(unknown, 'feature')).toBe(false);
    expect(parseChatFilter('is:')).toEqual({
      text: '',
      category: null,
      unknownCategory: null,
      teammate: null,
    });
  });

  it('lets the last is: win and matches only chats in that category', () => {
    const filter = parseChatFilter('is:docs is:refactor');
    expect(filter.category).toBe('refactor');
    expect(matchesFilter(filter, 'refactor')).toBe(true);
    expect(matchesFilter(filter, null)).toBe(false);
    expect(matchesFilter(parseChatFilter('plain'), null)).toBe(true);
  });

  it('filters by teammate with a with: token and keeps other words', () => {
    const pip = {
      id: '0190a0a0-0000-7000-8000-000000000001',
      name: 'Pip',
      role: '',
      face: { shape: 'round', color: 'sky' },
    } as const;
    const filter = parseChatFilter('with:Pip release');
    expect(filter).toMatchObject({ text: 'release', teammate: 'pip' });
    expect(matchesTeammate(filter, pip)).toBe(true);
    expect(matchesTeammate(filter, null)).toBe(false);
    expect(matchesTeammate(parseChatFilter('release'), null)).toBe(true);
  });

  it('adds, swaps and removes the teammate token', () => {
    expect(withTeammateToken('release', 'Code Buddy')).toBe('release with:codebuddy');
    expect(withTeammateToken('with:pip release', 'Wren')).toBe('release with:wren');
    expect(withTeammateToken('with:pip release', null)).toBe('release');
  });
});
