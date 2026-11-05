import { describe, expect, it } from 'vitest';
import { matchScore, rankFiles } from './file-match.ts';

const files = [
  'src/api/routes.ts',
  'src/api/project-routes.ts',
  'docs/routing.md',
  'README.md',
  'apps/web/src/Router.tsx',
];

describe('project file matching', () => {
  it('ranks exact and prefix name matches ahead of path and fuzzy matches', () => {
    expect(rankFiles('routes', files, 10).paths.slice(0, 2)).toEqual([
      'src/api/routes.ts',
      'src/api/project-routes.ts',
    ]);
    expect(rankFiles('api', files, 10).paths).toEqual([
      'src/api/routes.ts',
      'src/api/project-routes.ts',
    ]);
  });

  it('falls back to in-order fuzzy matches and ignores case', () => {
    expect(matchScore('RDME', 'README.md')).not.toBeNull();
    expect(matchScore('zz', 'README.md')).toBeNull();
    expect(rankFiles('rtr', files, 10).paths).toContain('apps/web/src/Router.tsx');
  });

  it('lists everything for an empty query and reports truncation', () => {
    const ranked = rankFiles('', files, 2);
    expect(ranked.paths).toEqual(['README.md', 'docs/routing.md']);
    expect(ranked.truncated).toBe(true);
    expect(rankFiles('', files, 5).truncated).toBe(false);
  });
});
