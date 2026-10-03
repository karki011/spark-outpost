import { expect, test } from '@playwright/test';
import {
  agentHead,
  card,
  crewChat,
  crewRepo,
  failingCheck,
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

test('the kept card asks why code was removed, and Builders run without a budget', async ({
  page,
}) => {
  test.setTimeout(90_000);
  repo.commit('totals.ts', TOTALS);
  await crewChat(page, repo, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, 'Fix the divider #build #removehelper #criticremoval');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  const laws = keep.getByRole('list', { name: 'Worth a look' });
  await expect(laws).toContainText('Removed helperTotals from totals.ts — why?');
  await expect(laws.locator('code').first()).toHaveText('helperTotals');
  await expect(agentHead(page, 'Bolt').first()).toBeVisible();
  await expect(page.locator('.crew-turn')).not.toContainText(/budget \d+ tool calls/);
  await expect(keep.getByRole('status').first()).toHaveText('Kept automatically.');
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
});

test('a plan card shows a rough estimate before Spark has history', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Rename the runs table column and migrate old rows #build');
  const plan = card(page, /Build this plan\?/);
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.locator('.ck-estimate')).toHaveText(
    /^Rough estimate: ~\d+ min, ~\$\d+\.\d+ \(.+\); fewer than 5 similar runs to learn from yet$/,
  );
  await plan.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
});
