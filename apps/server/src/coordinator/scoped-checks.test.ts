import { describe, expect, it } from 'vitest';
import { scopedCheckProblem } from './scoped-checks.ts';

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
    ['prettier --write apps/web/src/a.ts', /changes files/],
    ['pnpm vitest run', /names no path or package/],
  ])('refuses %s', (command, problem) => {
    expect(scopedCheckProblem(command, PROJECT)).toMatch(problem);
  });
});
