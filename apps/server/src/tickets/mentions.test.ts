import { describe, expect, it } from 'vitest';
import { branchTitleWithKeys, mentionIntent, ticketMentions, titleWithKeys } from './mentions.ts';

const keys = (text: string) => ticketMentions(text).map((mention) => mention.key);

describe('ticket mentions', () => {
  it('finds ticket keys in plain text, once each and in order', () => {
    expect(keys('Fix the login bug in ABC-123.')).toEqual(['ABC-123']);
    expect(keys('ABC-123 and ENG-12, then ABC-123 again (OPS_2-4)')).toEqual([
      'ABC-123',
      'ENG-12',
      'OPS_2-4',
    ]);
  });

  it('ignores lower case words, versions, paths and zero numbers', () => {
    expect(keys('utf-8 and gpt-5 and v2-1')).toEqual([]);
    expect(keys('see src/ABC-12/file.ts and foo.ABC-12 and ABC-0 and ABC-12-rc')).toEqual([]);
  });

  it('reads Linear issue links as Linear tickets', () => {
    expect(
      ticketMentions('Look at https://linear.app/acme/issue/eng-12/date-divider please'),
    ).toEqual([{ key: 'ENG-12', source: 'linear', site: null }]);
  });

  it('reads Jira browse and board links with their site', () => {
    expect(ticketMentions('https://acme.atlassian.net/browse/API-81.')).toEqual([
      { key: 'API-81', source: 'jira', site: 'https://acme.atlassian.net' },
    ]);
    expect(
      ticketMentions(
        'https://acme.atlassian.net/jira/software/projects/API/boards/1?selectedIssue=API-7',
      ),
    ).toEqual([{ key: 'API-7', source: 'jira', site: 'https://acme.atlassian.net' }]);
  });

  it('does not read keys out of other links', () => {
    expect(keys('https://github.com/acme/web/pull/ABC-12 https://example.com/x?y=ABC-3')).toEqual(
      [],
    );
  });

  it('needs two characters before the dash and keeps at most five mentions', () => {
    expect(keys('A-1 B-1')).toEqual([]);
    expect(keys('AA-1 BB-1 CC-1 DD-1 EE-1 FF-1')).toEqual(['AA-1', 'BB-1', 'CC-1', 'DD-1', 'EE-1']);
  });
});

describe('whether a request works on the ticket it names', () => {
  const intent = (text: string) => mentionIntent(text, ticketMentions(text)[0]!);

  it('treats fixing, implementing or pasting the ticket as working on it', () => {
    expect(intent('Fix the login bug in ABC-123')).toBe('target');
    expect(intent('implement ABC-123 please')).toBe('target');
    expect(intent('Can you work on ABC-123?')).toBe('target');
    expect(intent('Resolve ABC-123 and add a test')).toBe('target');
    expect(intent('ABC-123: make the export paginate')).toBe('target');
    expect(intent('[ABC-123] make the export paginate')).toBe('target');
    expect(intent('ABC-123')).toBe('target');
    expect(intent('https://linear.app/acme/issue/ABC-123/export')).toBe('target');
    expect(intent('Please fix https://acme.atlassian.net/browse/ABC-123')).toBe('target');
  });

  it('treats analysis and references as mentions only', () => {
    expect(intent('analyse ABC-123')).toBe('reference');
    expect(intent('Similar to ABC-122, fix the signup form')).toBe('reference');
    expect(intent('Fix the signup form like ABC-122')).toBe('reference');
    expect(intent('Fix the form, see ABC-122 for context')).toBe('reference');
    expect(intent('What is ABC-122 about?')).toBe('reference');
    expect(intent('The upload fails. ABC-122 had the same trace')).toBe('reference');
    expect(intent('Look at ABC-122 before we start')).toBe('reference');
  });
});

describe('titles with ticket keys', () => {
  it('adds missing keys in front of a pull request title', () => {
    expect(titleWithKeys('Fix the login bug', ['ABC-123'])).toBe('ABC-123: Fix the login bug');
    expect(titleWithKeys('Fix abc-123 login', ['ABC-123'])).toBe('Fix abc-123 login');
    expect(titleWithKeys('Fix it', ['A-1', 'B-2'])).toBe('A-1, B-2: Fix it');
    expect(titleWithKeys('Fix it', [])).toBe('Fix it');
  });

  it('puts the keys first in a branch title without repeating them', () => {
    expect(branchTitleWithKeys('Fix the login bug in ABC-123', ['ABC-123'])).toBe(
      'ABC-123 Fix the login bug in',
    );
    expect(branchTitleWithKeys('ABC-123: Fix the login bug', ['ABC-123'])).toBe(
      'ABC-123 Fix the login bug',
    );
    expect(branchTitleWithKeys('Fix it', [])).toBe('Fix it');
    expect(branchTitleWithKeys('Similar to ABC-122, fix ABC-7', ['ABC-7'], ['ABC-122'])).toBe(
      'ABC-7 Similar to , fix',
    );
    expect(branchTitleWithKeys('analyse ABC-122', [], ['ABC-122'])).toBe('analyse');
  });
});
