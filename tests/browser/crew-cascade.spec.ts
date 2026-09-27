import { expect, test } from '@playwright/test';
import {
  allowEdit,
  card,
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

test('Jev finds the change incomplete, so the Builder reruns once one tier up', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Fix the divider after midnight and add a test #build #unsupported');
  await allowEdit(page);
  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 60_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(
    page.locator('.md', {
      hasText: 'The Builder ran again one tier up after Jev could not confirm',
    }),
  ).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\nfinished what was missing\n');
});

test('Jev declines to judge the change, so a card asks you before finishing', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Fix the divider after midnight #build #declined');
  await allowEdit(page);
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
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(repo.notes()).toBe('start\nstep 1\n');
});
