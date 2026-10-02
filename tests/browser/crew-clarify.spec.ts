import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

const SHOTS = process.env.SPARK_SHOTS ?? '';
const QUESTIONS = /Spark has a few questions/;
const HELD = 'Waiting for your answer — this would change data permanently';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/docked-${name}.png` });
}

const statusLine = (page: Page) => page.locator('.cstatus');
const thread = (page: Page) => page.locator('.thread');

test('the questions wait in the thread at Review each step with a one-line summary above the composer, wait without a countdown, and a quick answer goes back in the thread', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await autoContinueAfter(page, 60);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Make the reports better #build #vague #questions');
  const questions = thread(page).getByRole('group', { name: QUESTIONS });
  await expect(questions).toBeVisible({ timeout: 30_000 });
  await expect(questions).toContainText('Which report?');
  await expect(questions).toContainText('Best guess: Spend');
  await expect(questions.getByRole('button', { name: /best guesses in/ })).toHaveCount(0);
  await expect(questions.getByRole('button', { name: 'Go with my best guesses' })).toBeVisible();
  await expect(thread(page).getByText('Which report do you mean: Spend or Usage?')).toBeVisible();
  await expect(statusLine(page)).toContainText('Waiting for you · questions: Which report? +1');
  await expect(page.getByText('"questions"')).toHaveCount(0);

  const lineBox = (await statusLine(page).boundingBox())!;
  const composerBox = (await page.locator('.composer').boundingBox())!;
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(composerBox.y + 1);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('.cstatus').analyze();
  expect(axe.violations).toEqual([]);
  await shot(page, 'questions');

  await questions.getByRole('button', { name: 'Usage' }).click();
  await expect(questions.getByRole('button', { name: 'Usage' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await questions.getByRole('button', { name: 'Send' }).click();

  const answered = thread(page).getByRole('group', { name: QUESTIONS });
  await expect(answered).toContainText('Answered.');
  await expect(answered).toContainText('Which report? → Usage');
  await expect(statusLine(page)).not.toContainText('Waiting for you');
  await allowEdit(page);
  await expect(card(page, /Keep these changes\?/)).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\n');
  await shot(page, 'answered');
});

test('Automatic goes with the best guesses when the wait runs out, and says so', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Make the reports better #build #vague #questions');
  const questions = thread(page).getByRole('group', { name: QUESTIONS });
  await expect(
    questions.getByRole('button', { name: /^Going with my best guesses in \ds$/ }),
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, 'countdown');
  const resolved = thread(page).getByRole('group', { name: QUESTIONS });
  await expect(resolved).toContainText('Went with the best guesses after 3s.', {
    timeout: 10_000,
  });
  await expect(resolved.getByRole('button', { name: 'Send' })).toHaveCount(0);
});

test('Full auto counts down to the best guesses, then to building the plan', async ({ page }) => {
  test.setTimeout(90_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Full auto');
  await send(page, 'Make the reports better #build #vague #questions');
  const questions = card(page, QUESTIONS);
  await expect(
    questions.getByRole('button', { name: /^Going with my best guesses in \ds$/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(questions).toContainText('Went with the best guesses after 3s.', {
    timeout: 10_000,
  });

  const plan = card(page, /Build this plan\?/);
  await expect(plan.getByRole('button', { name: /^Building this plan in \ds$/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(plan.getByRole('button', { name: 'Edit plan' })).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(plan).toContainText('Continued automatically after 3s.', { timeout: 10_000 });
  await expect.poll(() => repo.notes(), { timeout: 30_000 }).toBe('start\nstep 1\n');
});

test('destructive work waits for your answer instead of counting down, then plans first', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await autoContinueAfter(page, 2);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Clean up the reports table — drop the old rows #build #vague #questions');
  const questions = thread(page).getByRole('group', { name: QUESTIONS });
  await expect(questions).toBeVisible({ timeout: 30_000 });
  await expect(questions.getByRole('status')).toHaveText(HELD);
  await expect(questions.getByRole('button', { name: /best guesses in/ })).toHaveCount(0);
  await expect(questions.getByRole('button', { name: 'Go with my best guesses' })).toBeVisible();
  await shot(page, 'held');
  await page.waitForTimeout(3_000);
  await expect(questions).toContainText('Which report?');
  await expect(thread(page).getByText('Went with the best guesses')).toHaveCount(0);
  await questions.getByRole('button', { name: 'Usage' }).click();
  await questions.getByRole('button', { name: 'Send' }).click();

  const plan = card(page, /Build this plan\?/);
  await expect(plan.getByRole('status')).toHaveText(HELD, { timeout: 30_000 });
  await expect(plan.getByRole('button', { name: /Building this plan in/ })).toHaveCount(0);
  await page.waitForTimeout(3_000);
  expect(repo.notes()).toBe('start\n');
  await plan.getByRole('button', { name: 'Build this plan' }).click();
  await expect(plan).not.toContainText(HELD);
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
});
