import { expect, test } from '@playwright/test';
import {
  agentHead,
  card,
  keptResult,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const SHOTS = 'test-results/keep-flow';

test('Automatic keeps without a blocking card and notes the Critic’s concerns', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider #build #crew #stuckreview');
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 200_000 });
  await expect(card(page, /Keep these changes\?/)).toHaveCount(0);
  const kept = keptResult(page);
  await expect(kept).toHaveCount(1);
  await expect(kept.locator('.result-note')).toContainText(
    'Kept automatically; worth a look: the Critic still has concerns.',
  );
  await expect(kept.getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Needs your input/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  await kept.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/automatic-kept-with-note.png` });
});

test('a failing Critic is retried once, then skipped with a quiet note', async ({ page }) => {
  test.setTimeout(240_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider #build #crew #criticdown');
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 200_000 });
  await expect(agentHead(page, 'Hawk')).toHaveCount(2);
  const kept = keptResult(page);
  await expect(kept.locator('.result-note')).toContainText(
    'the Critic was unavailable, so no AI review ran',
  );
  await expect(kept.getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/critic-skipped.png` });
});

test.fixme('the keep card puts its actions first and folds the file list into a summary', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #feature #bigdiff');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 200_000 });
  await expect(keep).toContainText(/4 files · \+\d+ −\d+/);
  const files = keep.getByRole('list', { name: 'Changed files' });
  await expect(files).toBeHidden();
  const keepButton = keep.getByRole('button', { name: 'Keep', exact: true });
  const summary = keep.getByText(/4 files · /);
  const keepBox = (await keepButton.boundingBox())!;
  const summaryBox = (await summary.boundingBox())!;
  expect(keepBox.y).toBeLessThan(summaryBox.y);
  await expect(keep.locator('.ck-top')).toHaveCSS('position', 'sticky');
  await expect(keep.getByRole('button', { name: 'View changes' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/keep-card-collapsed.png` });

  await keep.getByText('Show files').click();
  await expect(files).toBeVisible();
  await expect(files.locator('li')).toHaveCount(4);
  await page.screenshot({ path: `${SHOTS}/keep-card-files.png` });

  await keepButton.focus();
  await page.keyboard.press('Enter');
  await expect(keep).toContainText('Kept the changes.', { timeout: 30_000 });
});
