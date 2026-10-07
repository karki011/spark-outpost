import { expect, test } from '@playwright/test';
import {
  agentBlock,
  agentHead,
  allowEdit,
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  failingCheck,
  keptResult,
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

test('an unsure request is answered first, and Make the change builds the same request', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Tidy the heading #build #unsure');
  const makeChange = page.getByRole('button', { name: 'Make the change' });
  await expect(makeChange).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Answered without changing files.')).toBeVisible();
  await expect(card(page, /Jev has a question/)).toHaveCount(0);
  expect(repo.notes()).toBe('start\n');
  await makeChange.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg.me .bubble', { hasText: 'Tidy the heading' })).toHaveCount(2, {
    timeout: 30_000,
  });
  await allowEdit(page);
  await expect(keptResult(page)).toBeVisible({ timeout: 30_000 });
  await expect(makeChange).toHaveCount(0);
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('a Builder that keeps failing stops without a retry card and says it needs you', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #failstep 1');
  await expect(page.locator('.thread')).toContainText('Needs you: Stopped after 2 retries.', {
    timeout: 60_000,
  });
  await expect(card(page, /A step needs another try/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
});

test('the loop guard stops a Builder that repeats itself and reports', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #repeat');
  await expect(page.locator('.crew-turn')).toContainText('Stopped: Bolt repeated', {
    timeout: 30_000,
  });
  await expect(card(page, /Bolt was repeating itself/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\n');
});

test('Stop mid-Builder cancels the Builder and the crew', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, `${CREW_REQUEST} #build #crew #slowbuild`);
  const builder = agentHead(page, 'Bolt');
  await expect(builder).toContainText(/working|thinking|editing/, { timeout: 30_000 });
  await expect.poll(() => repo.notes()).toContain('step 1');
  await page.getByRole('button', { name: 'Stop' }).click();

  await expect(builder).toContainText('stopped', { timeout: 30_000 });
  await expect(builder.locator('.agent-ava')).toHaveClass(/\bstopped\b/);
  await expect(agentHead(page, 'Jev')).toContainText('stopped');
  await expect(page.locator('.crew-turn .agent-state.failed')).toHaveCount(0);
  await expect(page.locator('.crew-foot')).toContainText('Stopped 1 agent');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test.fixme('Fix from the keep card runs another Builder with your note', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await failingCheck(page, repo.root);
  await send(page, 'Fix the divider #build');
  const keep = card(page, /Keep these changes\?/).first();
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Fix' }).click();
  await keep.getByRole('textbox', { name: 'What should be fixed?' }).fill('Cache the time zone');
  await keep.getByRole('button', { name: 'Ask for a fix' }).click();
  await expect(keep).toContainText('Asked for a fix.');

  const again = card(page, /Keep these changes\?/).nth(1);
  await expect(again).toBeVisible({ timeout: 30_000 });
  await again.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-foot')).toContainText('Done 1 agent', { timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\nfixed as asked\n');
});

test('Auto-edit: Critic concerns get a fix round and a second review, then it keeps by itself', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, 'Fix the divider #build #crew #bugreview');
  await expect(agentHead(page, 'Hawk')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.crew-foot')).toContainText('Done 2 agents', { timeout: 30_000 });
  await expect(page.locator('.crew-turn')).toContainText('has concerns');
  await expect(agentBlock(page, 'Hawk').last()).toContainText('Verdict: looks good');
  await expect(card(page, /Keep these changes\?/)).toHaveCount(0);
  await expect(keptResult(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  expect(repo.notes()).toBe('start\nstep 1\nfixed the review findings\n');
});
