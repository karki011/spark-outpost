import { describe, expect, it } from 'vitest';
import { planSteps, uncoveredSteps, type CoveringPiece } from './plan-coverage.ts';

const PLAN = [
  '# Plan: Project budgets',
  '## Context',
  'Budgets end to end.',
  '## 1. Repository — `src/budgets.ts` (new file)',
  '- Follow the `src/projects.ts` pattern.',
  '```ts',
  '- not a step: code',
  '```',
  '## 2. Steps',
  '1. **`src/api.ts`** — add the budget routes:',
  '   - `GET`: return the amount and spent.',
  '   - `PUT`: validate `amount` before saving.',
  '2. **Tests** (mirror the existing files):',
  '   - `test/budgets.test.ts`: null before a budget is set.',
  '3. Import `getBudget` from `./budgets.ts`.',
  '4. Add a `budget` column to the CSV export.',
  '5. Run `npm test` and confirm everything passes.',
  '6. Manually sanity-check the upgrade with a script.',
  '- [x] Already done: read the fixture.',
  '## Decisions',
  '- Validation lives in the API.',
  '## Verification',
  '- The hidden tests pass.',
].join('\n');

function piece(title: string, paths: string[], reads: string[] = []): CoveringPiece {
  return {
    title,
    goal: title,
    acceptance: [],
    owns: paths,
    reads,
    contract: null,
    owned: { paths, globs: [] },
  };
}

describe('planSteps', () => {
  it('keeps the steps to build, with the files their section and parents name', () => {
    expect(planSteps(PLAN)).toEqual([
      {
        text: 'Follow the `src/projects.ts` pattern.',
        files: ['src/projects.ts', 'src/budgets.ts'],
      },
      { text: '`GET`: return the amount and spent.', files: ['src/api.ts'] },
      { text: '`PUT`: validate `amount` before saving.', files: ['src/api.ts'] },
      {
        text: '`test/budgets.test.ts`: null before a budget is set.',
        files: ['test/budgets.test.ts'],
      },
      { text: 'Import `getBudget` from `./budgets.ts`.', files: ['budgets.ts'] },
      { text: 'Add a `budget` column to the CSV export.', files: [] },
    ]);
  });
});

describe('uncoveredSteps', () => {
  const steps = planSteps(PLAN);
  const repository = piece('Budgets repository', ['src/budgets.ts', 'test/budgets.test.ts']);
  const api = piece('Budget API routes', ['src/api.ts']);
  const csv = piece('Budget column in the CSV export', ['src/export.ts']);

  it('covers sub-steps through the files a piece owns, by path or by name', () => {
    expect(uncoveredSteps(steps, [repository, api, csv])).toEqual([]);
  });

  it('still names the steps no piece takes', () => {
    expect(uncoveredSteps(steps, [repository, csv]).map((step) => step.text)).toEqual([
      '`GET`: return the amount and spent.',
      '`PUT`: validate `amount` before saving.',
    ]);
    expect(uncoveredSteps(steps, [repository, api]).map((step) => step.text)).toEqual([
      'Add a `budget` column to the CSV export.',
    ]);
  });
});
