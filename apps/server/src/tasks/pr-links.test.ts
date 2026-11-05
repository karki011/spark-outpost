import { describe, expect, it } from 'vitest';
import { findPullRequests } from './pr-links.ts';

describe('findPullRequests', () => {
  it('finds pull request links in gh output and prose', () => {
    expect(
      findPullRequests(
        'Creating pull request for fix/date into main\n\nhttps://github.com/karki/spark-outpost/pull/123\n',
      ),
    ).toEqual([
      { url: 'https://github.com/karki/spark-outpost/pull/123', title: 'karki/spark-outpost#123' },
    ]);
    expect(findPullRequests('Opened [the PR](https://github.com/a-b/c.d_e/pull/7).')).toEqual([
      { url: 'https://github.com/a-b/c.d_e/pull/7', title: 'a-b/c.d_e#7' },
    ]);
  });

  it('normalises sub-pages, www and duplicates to one link', () => {
    expect(
      findPullRequests(
        'http://www.github.com/o/r/pull/0042/files and https://github.com/o/r/pull/42#discussion',
      ),
    ).toEqual([{ url: 'https://github.com/o/r/pull/42', title: 'o/r#42' }]);
  });

  it('ignores issues, other hosts and look-alike domains', () => {
    expect(
      findPullRequests(
        [
          'https://github.com/o/r/issues/5',
          'https://gitlab.com/o/r/pull/5',
          'https://github.com/o/r/pulls',
          'https://github.company.com/o/r/pull/5',
        ].join(' '),
      ),
    ).toEqual([]);
  });
});
