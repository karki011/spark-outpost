import { expect, test } from '@playwright/test';
import { card, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  const sonnet = await page.request.patch('/api/providers/claude/defaults', {
    data: { model: 'sonnet' },
  });
  expect(sonnet.ok()).toBe(true);
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('Jev finds the change incomplete, so the Builder reruns once one tier up', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider after midnight and add a test #build #unsupported');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toContainText('Kept automatically.', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Done Bolt · Builder · Sonnet 5/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('button', { name: /^Done Bolt · Builder · Opus 5\.5/ }),
  ).toBeVisible();
  await expect(page.locator('.crew-turn')).toContainText('Finished what was missing');
  expect(repo.notes()).toBe('start\nstep 1\nfinished what was missing\n');
});

test('Jev declines to judge the change, so a card asks you before finishing', async ({ page }) => {
  test.setTimeout(60_000);
  const off = await page.request.patch('/api/profile', { data: { autoContinueSeconds: null } });
  expect(off.ok()).toBe(true);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider after midnight #build #declined');
  const verify = card(page, /Jev could not verify the change/);
  await expect(verify).toBeVisible({ timeout: 30_000 });
  await expect(verify).toContainText('Jev could not confirm the change does what you asked');
  await expect(verify.getByRole('button', { name: /^Retry with Opus/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Needs your input Fix the divider after midnight/ }),
  ).toBeVisible();
  await verify.getByRole('button', { name: 'Finish as it is' }).click();
  await expect(verify).toContainText('Finished without verification.');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toContainText('Kept automatically.', { timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\n');
});
