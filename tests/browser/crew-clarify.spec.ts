import { expect, test } from '@playwright/test';
import {
  allowEdit,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
  autoContinueAfter,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('a vague request gets the agent’s own questions, and a quick reply builds it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Make the reports better #build #vague #questions');
  const questions = card(page, /needs your input/);
  await expect(questions).toContainText('A few questions first', { timeout: 30_000 });
  await expect(questions).toContainText('Which report? (best guess: Spend)');
  await expect(page.getByText('Which report do you mean: Spend or Usage?')).toBeVisible();
  await expect(page.getByText('"questions"')).toHaveCount(0);
  await expect(questions.getByRole('button', { name: 'Go with my best guesses' })).toBeVisible();
  await questions.getByRole('button', { name: 'Usage' }).click();
  await expect(questions).toContainText('You chose: Usage');
  await allowEdit(page);
  await expect(card(page, /Keep these changes\?/)).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('Full auto counts down to the best guesses, then to building the plan', async ({ page }) => {
  test.setTimeout(90_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Full auto');
  await send(page, 'Make the reports better #build #vague #questions');
  const questions = card(page, /needs your input/);
  await expect(
    questions.getByRole('button', { name: /^Going with my best guesses in \ds$/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(questions).toContainText('Continued automatically after 3s.', { timeout: 10_000 });

  const plan = card(page, /Build this plan\?/);
  await expect(plan.getByRole('button', { name: /^Building this plan in \ds$/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(plan.getByRole('button', { name: 'Edit plan' })).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(plan).toContainText('Continued automatically after 3s.', { timeout: 10_000 });
  await expect.poll(() => repo.notes(), { timeout: 30_000 }).toBe('start\nstep 1\n');
});
