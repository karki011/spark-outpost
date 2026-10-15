import { describe, expect, it } from 'vitest';
import { matchSnippet, prefixQuery, searchWords, snippetText } from './search-snippet.ts';

describe('search words', () => {
  it('keeps letters and digits and drops operators and quotes', () => {
    expect(searchWords("fix  the auth's <-> & | !bug v1.2 the")).toEqual([
      'fix',
      'the',
      'auth',
      's',
      'bug',
      'v1',
      '2',
    ]);
    expect(prefixQuery(['fix', 'Ünï'])).toBe("'fix':* & 'Ünï':*");
  });
});

describe('match snippet', () => {
  it('marks whole words that start with a query word', () => {
    expect(matchSnippet('Rerun the runner; it runs.', 'run')).toEqual([
      { text: 'Rerun the ', match: false },
      { text: 'runner', match: true },
      { text: '; it ', match: false },
      { text: 'runs', match: true },
      { text: '.', match: false },
    ]);
  });

  it('centres a long message on the first match and marks what was cut', () => {
    const before = 'alpha '.repeat(40);
    const after = ' omega'.repeat(60);
    const parts = matchSnippet(`${before}\n\nneedle${after}`, 'needle');

    expect(parts[0]).toEqual({ text: '…', match: false });
    expect(parts.at(-1)).toEqual({ text: '…', match: false });
    expect(parts.filter((part) => part.match)).toEqual([{ text: 'needle', match: true }]);
    const text = snippetText(parts);
    expect(text.length).toBeLessThan(170);
    expect(text).not.toContain('\n');
    expect(text).toMatch(/^…alpha /);
  });

  it('shows the whole message when it fits, and fills the window near the end', () => {
    const short = `${'word '.repeat(20)}needle here`;
    expect(snippetText(matchSnippet(short, 'needle'))).toBe(short);
    const long = `${'word '.repeat(60)}needle`;
    const text = snippetText(matchSnippet(long, 'needle'));
    expect(text).toMatch(/^…word word .* needle$/);
    expect(text.length).toBeGreaterThan(150);
  });

  it('matches a query without words as literal text', () => {
    expect(matchSnippet('a (?) -> b', '(?) ->')).toEqual([
      { text: 'a ', match: false },
      { text: '(?) ->', match: true },
      { text: ' b', match: false },
    ]);
  });

  it('starts at the beginning when no word matches', () => {
    expect(matchSnippet('nothing to see', 'zzz')).toEqual([
      { text: 'nothing to see', match: false },
    ]);
  });
});
