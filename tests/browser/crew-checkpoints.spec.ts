import { expect, test } from '@playwright/test';
import {
  CREW_REQUEST,
  agentBlock,
  agentHead,
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

test('clarify takes an answer in your own words and works from it', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, 'Make the reports better #build #vague');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: /^Needs your input Make the reports better/ }),
  ).toBeVisible();
  const answer = clarify.getByRole('textbox', { name: 'Or answer in your own words' });
  await answer.fill('Only the top heading');
  await clarify.getByRole('button', { name: 'Send' }).click();
  await expect(clarify).toContainText('Answered.');
  await expect(clarify).toContainText('Only the top heading');

  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(
    page.locator('.md', { hasText: 'Clarified: Only the top heading' }).first(),
  ).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('a vague request gets one short question with likely readings', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, 'Make the reports better #build #vague');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify).toContainText('What should change?', { timeout: 30_000 });
  await expect(clarify.getByRole('button', { name: 'Improve its documentation' })).toBeVisible();
  await clarify.getByRole('button', { name: 'Add new behaviour or features' }).click();
  await expect(clarify).toContainText('You chose: Add new behaviour or features');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(
    page.locator('.md', { hasText: 'Clarified: Add new behaviour or features' }).first(),
  ).toBeVisible({ timeout: 30_000 });
});

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
  await expect(card(page, /Keep these changes\?/)).toBeVisible({ timeout: 30_000 });
  await expect(makeChange).toHaveCount(0);
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('a Builder that keeps failing stops on a retry card, which stops and reports', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #failstep 1');
  const retry = card(page, /A step needs another try/);
  await expect(retry).toBeVisible({ timeout: 60_000 });
  await expect(retry).toContainText('Stopped after 2 retries.');
  await retry.getByRole('button', { name: 'Stop and report' }).click();
  await expect(retry).toContainText('Stopped and reported.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
});

test('the loop guard stops a Builder that repeats itself, and Continue resumes it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #repeat');
  const stuck = card(page, /Bolt was repeating itself/);
  await expect(stuck).toBeVisible({ timeout: 30_000 });
  await stuck.getByRole('button', { name: 'Continue' }).click();
  await expect(stuck).toContainText('Continued with a note to try another way.');
  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toContainText('Kept: you approved every edit.', { timeout: 30_000 });
  expect(repo.notes()).toBe('start\ntried another way\n');
});

test('risky work shows a card before the Builder starts, and Build it goes on', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, 'Rename the runs table column and migrate old rows #build');
  const risky = card(page, /Start this risky change\?/);
  await expect(risky).toBeVisible({ timeout: 30_000 });
  await expect(risky).toContainText('looks destructive');
  expect(repo.notes()).toBe('start\n');
  await risky.getByRole('button', { name: 'Build it' }).click();
  await expect(risky).toContainText('Making the change.');
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });
  expect(repo.notes()).toContain('step 1');
});

test('Stop mid-Builder cancels the Builder and the crew', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Auto-edit');
  await send(page, `${CREW_REQUEST} #build #crew #slowbuild`);
  const builder = agentHead(page, 'Bolt');
  await expect(builder).toContainText(/Working|Thinking/, { timeout: 30_000 });
  await expect.poll(() => repo.notes()).toContain('step 1');
  await page.getByRole('button', { name: 'Stop' }).click();

  await expect(builder).toContainText('Stopped', { timeout: 30_000 });
  await expect(builder.locator('.agent-ava')).toHaveClass(/\bstopped\b/);
  await expect(agentHead(page, 'Jev')).toContainText('Stopped');
  await expect(page.locator('.crew-turn .agent-state.failed')).toHaveCount(0);
  await expect(page.locator('.crew-foot')).toContainText('Done 1 agent');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('Fix from the keep card runs another Builder with your note', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Review keep');
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
  const kept = card(page, /Keep these changes\?/);
  await expect(kept).toHaveCount(1);
  await expect(kept).toContainText('Kept automatically.');
  await expect(kept.getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revert to before this run' })).toBeVisible();
  expect(repo.notes()).toBe('start\nstep 1\nfixed the review findings\n');
});

test('Review each step: "Fix these findings" on the keep card sends the review back to the Builder', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Review keep');
  await send(page, 'Fix the divider #build #crew #bugreview');
  const keep = card(page, /Keep these changes\?/).first();
  await expect(keep).toContainText('The AI review found 2 correctness findings.', {
    timeout: 30_000,
  });
  await expect(keep.getByRole('button', { name: 'Keep', exact: true })).toHaveClass(/primary/);
  await keep.getByRole('button', { name: 'Fix these findings' }).click();
  await expect(keep).toContainText('Sent the review findings back to the Builder.');

  const again = card(page, /Keep these changes\?/).nth(1);
  await expect(again).toContainText('Fixed after 1 review round', { timeout: 30_000 });
  await expect(again.getByRole('button', { name: /Fix these findings|Fix again/ })).toHaveCount(0);
  await again.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(repo.notes()).toBe('start\nstep 1\nfixed the review findings\n');
});

test('an unanswered Jev question counts down and continues with the rules', async ({ page }) => {
  test.setTimeout(60_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Make the reports better #build #vague');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify.getByRole('button', { name: /^Continue \(\ds\)$/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(clarify).toContainText('Continued automatically after 3s.', { timeout: 10_000 });
  await allowEdit(page);
  await expect(card(page, /Keep these changes\?/)).toBeVisible({ timeout: 30_000 });
});

test('typing an answer holds the countdown', async ({ page }) => {
  test.setTimeout(60_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Make the reports better #build #vague');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify.getByRole('button', { name: /^Continue \(\ds\)$/ })).toBeVisible({
    timeout: 30_000,
  });
  await clarify.getByRole('textbox', { name: 'Or answer in your own words' }).fill('Only the top');
  await expect(clarify.getByRole('button', { name: 'Let the rules decide' })).toBeVisible();
  await page.waitForTimeout(4_000);
  await expect(clarify).not.toContainText('Continued automatically');
  await clarify.getByRole('button', { name: 'Send' }).click();
  await expect(clarify).toContainText('Answered.');
});
