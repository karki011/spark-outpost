import { expect, test } from '@playwright/test';
import {
  card,
  crewChat,
  crewRepo,
  keptResult,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

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
  await expect(keptResult(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Done Bolt · Builder · Sonnet 5/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('button', { name: /^Done Bolt · Builder · Opus 5\.5/ }),
  ).toBeVisible();
  await expect(page.locator('.crew-turn')).toContainText('Finished what was missing');
  expect(repo.notes()).toBe('start\nstep 1\nfinished what was missing\n');
});

test('Jev declines to judge the change, so the change is kept with no card and the reply says it needs you', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider after midnight #build #declined');
  await expect(keptResult(page)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, /Jev could not verify the change/)).toHaveCount(0);
  await expect(page.locator('.thread')).toContainText(
    'Needs you: Jev could not confirm the change does what you asked',
  );
  expect(repo.notes()).toBe('start\nstep 1\n');
});
