import type { DaySession } from '../dev-day/session-types.ts';
import type { LevelKey } from '../dev-day/levels.ts';

export const STORY_HIDDEN = 'story-budgets.test.ts';
export const STORY_HIDDEN_TESTS = 10;
export const NODE_TESTS = 'node --test "test/**/*.test.ts"';
export const FAILED_STORY_MINUTES = 30;
export const STORY_ALLOWED = ['migrations/**', 'src/**', 'test/**', 'README.md'];

export const STORY_REQUEST = [
  'Add project budgets to the workbench, end to end:',
  '- Database: a new migration `migrations/003_project_budgets.sql` with a `project_budgets` table (`project_id` INTEGER PRIMARY KEY REFERENCES projects(id), `amount` INTEGER NOT NULL). Existing databases must upgrade in place; their projects start with no budget.',
  '- Repository: `src/budgets.ts` with `getBudget(db, projectId): number | null` and `setBudget(db, projectId, amount): void` (setting again replaces the budget).',
  '- API in `src/api.ts`: `GET /projects/:id/budget` and `PUT /projects/:id/budget` with `{ "amount": number }`. Both answer 200 `{ projectId, amount, spent }`, where `amount` is null when no budget is set and `spent` is the project\'s expense total. `amount` must be a JSON number that is a positive whole number, else 400 and nothing changes; an unknown project is a 404.',
  '- Budget bar on the project page: `renderProjectPage(project, spent, budget)` in `src/ui.ts` (budget is a number or null) adds `<div class="budget-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="N">`, where N is spent as a whole percent of the budget, capped at 100; the bar also gets the class `over` when spent is more than the budget. With no budget it shows `<p class="no-budget">No budget set</p>` instead of a bar.',
  '- Over-budget badge in the analytics list: `analyticsRows(db)` in `src/analytics.ts` also returns `budget` (number or null) and `overBudget` (spent > budget); `renderAnalytics` adds `<span class="badge over-budget">Over budget</span>` to the rows of over-budget projects only.',
  '- CSV export: `projectsCsv(db)` in `src/export.ts` gains a `budget` column after `spent`, empty when the project has no budget.',
  '- Tests for each part under `test/`.',
].join('\n');

export const STORY_PR_SUFFIX = '\n\nShip it as a draft PR when it is done.';

export function storySession(level: LevelKey, fakeTags: string, ship: boolean): DaySession {
  return {
    id: ship ? 'story-pr' : 'story',
    title: 'Story: project budgets (migration, repository, API, UI bar, analytics badge, CSV)',
    why: 'Sized so one Builder can still finish it but a coordinator would split it.',
    repo: 'workbench',
    thread: `story-${level}`,
    level,
    turns: [{ text: `${STORY_REQUEST}${ship ? STORY_PR_SUFFIX : ''}`, fakeTags }],
    expect: { kind: 'build', hidden: STORY_HIDDEN, allowed: STORY_ALLOWED },
    behaviors: ship ? ['draftPr'] : [],
    checks: [NODE_TESTS],
    ship,
    expectUsd: { harness: 2.5, 'direct-claude': 1.5, 'direct-codex': 1 },
    repairMinutes: FAILED_STORY_MINUTES,
    repairWhy: 'finish or fix the missing layers and their tests by hand',
  };
}
