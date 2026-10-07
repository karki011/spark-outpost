import { expect, test } from '@playwright/test';
import {
  agentHead,
  crewChat,
  crewRepo,
  failingCheck,
  keptResult,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const TOTALS = `export function sumTotals(rows: number[]): number {
  return rows.reduce((sum, row) => sum + row, 0);
}

export function helperTotals(rows: number[]): number {
  return rows.length;
}
`;

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('the kept card asks why code was removed', async ({ page }) => {
  test.setTimeout(90_000);
  repo.commit('totals.ts', TOTALS);
  await crewChat(page, repo, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, 'Fix the divider #build #removehelper #criticremoval');
  const keep = keptResult(page);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  const laws = keep.getByRole('list', { name: 'Worth a look' });
  await expect(laws).toContainText('Removed helperTotals from totals.ts — why?');
  await expect(laws.locator('code').first()).toHaveText('helperTotals');
  await expect(agentHead(page, 'Bolt').first()).toBeVisible();
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
});
