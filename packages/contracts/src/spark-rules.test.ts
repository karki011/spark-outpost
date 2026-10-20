import { describe, expect, it } from 'vitest';
import { ghAllowedSchema, ghPrefixProblem, updateSparkRulesRequestSchema } from './spark-rules.ts';

describe('ghPrefixProblem()', () => {
  it.each([
    'gh release create',
    'gh issue create',
    'gh pr close',
    'gh repo edit',
    '  GH  Pr  Ready ',
  ])('accepts %s', (prefix) => {
    expect(ghPrefixProblem(prefix)).toBeNull();
  });

  it.each([
    ['gh release', 'two words'],
    ['gh release create v1', 'two words'],
    ['git push origin', 'two words'],
    ['gh release create; rm -rf /', 'two words'],
    ['gh -R x release', 'two words'],
    ['gh api graphql', 'gh api'],
    ['gh auth token', 'gh auth'],
    ['gh pr merge', 'never merges'],
    ['gh pr create', 'publish rules'],
    ['gh workflow run', 'Run a workflow'],
    ['gh run rerun', 'Run a workflow'],
    ['gh pr view', 'always allowed'],
    ['gh search code', 'always allowed'],
  ])('refuses %s', (prefix, words) => {
    expect(ghPrefixProblem(prefix)).toContain(words);
  });
});

describe('ghAllowedSchema', () => {
  it('tidies and removes duplicates', () => {
    expect(ghAllowedSchema.parse(['gh release create', ' GH release  create'])).toEqual([
      'gh release create',
    ]);
  });

  it('refuses a list holding a never-allowed command', () => {
    expect(ghAllowedSchema.safeParse(['gh release create', 'gh pr merge']).success).toBe(false);
  });

  it('refuses more than twenty commands', () => {
    const many = Array.from({ length: 21 }, (_, index) => `gh release c${index}`);
    expect(ghAllowedSchema.safeParse(many).success).toBe(false);
  });
});

describe('updateSparkRulesRequestSchema', () => {
  it('needs at least one change', () => {
    expect(updateSparkRulesRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSparkRulesRequestSchema.safeParse({ workflows: 'refused' }).success).toBe(true);
  });
});
