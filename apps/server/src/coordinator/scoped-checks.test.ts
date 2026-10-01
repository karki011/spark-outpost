import { describe, expect, it } from 'vitest';
import { docsOnly, scopedCheckProblem } from './scoped-checks.ts';

const PROJECT = ['pnpm test', 'pnpm typecheck'];

describe('scopedCheckProblem', () => {
  it.each([
    'pnpm vitest run apps/server/src/persistence/tags.test.ts',
    'pnpm --filter @spark-outpost/web typecheck',
    'npx tsc -p apps/web/tsconfig.json --noEmit',
    'pytest tests/test_tags.py',
  ])('accepts %s', (command) => {
    expect(scopedCheckProblem(command, PROJECT)).toBeNull();
  });

  it.each([
    ['pnpm test', /whole-project check/],
    ['pnpm check', /runs the whole project/],
    ['pnpm install', /installs packages/],
    ['npx prettier --write apps/web/src/a.ts', /changes files/],
    ['pnpm vitest run', /names no path or package/],
    ['rm -rf src/tags', /runs `rm`, which is not a test runner/],
  ])('refuses %s', (command, problem) => {
    expect(scopedCheckProblem(command, PROJECT)).toMatch(problem);
  });
});

describe('docsOnly', () => {
  it('holds when every owned file is docs or text', () => {
    expect(docsOnly(['README.md'])).toBe(true);
    expect(docsOnly(['docs/guide.mdx', 'docs/**/*.md', 'NOTES.txt', 'CHANGELOG'])).toBe(true);
  });

  it('fails for code, mixed or empty ownership', () => {
    expect(docsOnly(['README.md', 'src/index.ts'])).toBe(false);
    expect(docsOnly(['src/readme.ts'])).toBe(false);
    expect(docsOnly([])).toBe(false);
  });
});
