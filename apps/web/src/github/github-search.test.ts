import { describe, expect, it } from 'vitest';
import {
  highlightParts,
  matchCounts,
  matchItem,
  searchItems,
  searchTerms,
} from './github-search.ts';
import { inboxItem } from './inbox-item-fixture.ts';

describe('searching the GitHub page', () => {
  it('matches every word anywhere, ignoring case and extra spaces', () => {
    const pull = inboxItem({ title: 'Retry webhooks', author: 'lee-wu', repo: 'acme/api' });
    expect(matchItem(pull, searchTerms('  WEBHOOK   lee '))).toEqual({ item: pull, hidden: null });
    expect(matchItem(pull, searchTerms('webhook billing'))).toBeNull();
  });

  it('finds a pull request by number, ticket key and label', () => {
    const pull = inboxItem({
      number: 321,
      ticket: { source: 'jira', key: 'API-9', title: null, status: null, url: null },
      labels: [{ name: 'needs-docs', color: null }],
    });
    expect(matchItem(pull, searchTerms('#321'))).not.toBeNull();
    expect(matchItem(pull, searchTerms('api-9'))).not.toBeNull();
    expect(matchItem(pull, searchTerms('docs'))).not.toBeNull();
  });

  it('says when the match is only in the branch', () => {
    const pull = inboxItem({ headRef: 'spark/held-chats', baseRef: 'main' });
    expect(matchItem(pull, searchTerms('held'))?.hidden).toEqual({
      where: 'branch',
      text: 'spark/held-chats → main',
    });
  });

  it('shows a short piece of the description around a match found only there', () => {
    const body = `${'a '.repeat(60)}the sub-chat tree\nmoves ${'b '.repeat(60)}`;
    const hidden = matchItem(inboxItem({ bodyPreview: body }), searchTerms('sub-chat'))?.hidden;
    expect(hidden?.where).toBe('body');
    expect(hidden?.text).toContain('the sub-chat tree moves');
    expect(hidden?.text.startsWith('…')).toBe(true);
    expect(hidden?.text.endsWith('…')).toBe(true);
  });

  it('counts matches per group', () => {
    const matches = searchItems(
      [
        inboxItem({ id: 'a#1', title: 'Fix login' }),
        inboxItem({ id: 'a#2', title: 'Fix logout', group: 'needs_fixes' }),
        inboxItem({ id: 'a#3', title: 'Add billing', group: 'waiting' }),
      ],
      searchTerms('log'),
    );
    expect(matchCounts(matches)).toEqual({
      review_requested: 1,
      needs_fixes: 1,
      ready_to_merge: 0,
      waiting: 0,
    });
  });

  it('marks each matched stretch of text', () => {
    expect(highlightParts('Fix the fixture', ['fix'])).toEqual([
      { text: 'Fix', hit: true },
      { text: ' the ', hit: false },
      { text: 'fix', hit: true },
      { text: 'ture', hit: false },
    ]);
    expect(highlightParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});
