import { describe, expect, it } from 'vitest';
import { guideSections } from './sections.ts';
import { searchGuide } from './search.ts';

describe('searchGuide', () => {
  it('returns section titles and ids only when the query is empty', () => {
    const results = searchGuide(guideSections, undefined, 5);
    expect(results).toHaveLength(guideSections.length);
    for (const result of results) {
      expect(result.score).toBe(0);
      expect(typeof result.id).toBe('string');
      expect(typeof result.title).toBe('string');
    }
  });

  it('ranks a title hit above a text-only hit', () => {
    const results = searchGuide(guideSections, 'autonomy levels', 5);
    expect(results[0]?.id).toBe('autonomy-levels');
  });

  it('tolerates simple plural and stem differences', () => {
    const plural = searchGuide(guideSections, 'worktrees', 3);
    const singular = searchGuide(guideSections, 'worktree', 3);
    expect(plural.map((result) => result.id)).toContain('worktrees');
    expect(singular.map((result) => result.id)).toContain('worktrees');
  });

  it('respects the limit and only returns positive-score matches', () => {
    const results = searchGuide(guideSections, 'ship draft pull request', 1);
    expect(results).toHaveLength(1);
    expect(results.every((result) => result.score > 0)).toBe(true);
  });

  it('returns nothing for a query that matches no section', () => {
    const results = searchGuide(guideSections, 'zzzznonexistentqueryxyz', 5);
    expect(results).toHaveLength(0);
  });
});
