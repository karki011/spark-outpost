import { expect, test, type Page } from '@playwright/test';
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
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Tidy the heading #build #unsure');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify).toBeVisible({ timeout: 30_000 });
  await expect(clarify.getByRole('button', { name: 'Make the change directly' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Needs your input Tidy the heading/ }),
  ).toBeVisible();
  const answer = clarify.getByRole('textbox', { name: 'Or answer in your own words' });
  await answer.fill('Only the top heading');
  await clarify.getByRole('button', { name: 'Send' }).click();
  await expect(clarify).toContainText('Answered.');
  await expect(clarify).toContainText('Only the top heading');

  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.md', { hasText: 'Clarified: Only the top heading' })).toBeVisible({
    timeout: 30_000,
  });
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('a vague request gets one short question with likely readings', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Make the reports better #build #vague');
  const clarify = card(page, /Jev has a question/);
  await expect(clarify).toContainText('What should change?', { timeout: 30_000 });
  await expect(clarify.getByRole('button', { name: 'Improve its documentation' })).toBeVisible();
  await clarify.getByRole('button', { name: 'Add new behaviour or features' }).click();
  await expect(clarify).toContainText('You chose: Add new behaviour or features');
  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(
    page.locator('.md', { hasText: 'Clarified: Add new behaviour or features' }),
  ).toBeVisible({ timeout: 30_000 });
});

test('a clarify option answers with one click', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Tidy the heading #build #unsure');
  const clarify = card(page, /Jev has a question/);
  await clarify
    .getByRole('button', { name: 'Make the change directly' })
    .click({ timeout: 30_000 });
  await expect(clarify).toContainText('You chose: Make the change directly');
  await allowEdit(page);
  await expect(card(page, /Keep these changes\?/)).toBeVisible({ timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\n');
});

test('a retry card escalates the Builder one tier', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Fix the divider #build #retry');
  await allowEdit(page);
  const retry = card(page, /A step needs another try/);
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await expect(retry).toContainText('Jev suggests retrying with Opus 5.5 · medium.');
  await retry.getByRole('button', { name: 'Retry' }).click();
  await expect(retry).toContainText('Retrying.');

  await expect(page.locator('.crew-turn')).toBeVisible({ timeout: 30_000 });
  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/);
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-foot')).toContainText('Done 1 agent', { timeout: 30_000 });
  const heads = page.locator('.crew-turn .agent-name', { hasText: /^Bolt$/ });
  await expect(heads).toHaveCount(2);
  await expect(agentHead(page, 'Bolt').last()).toContainText('Opus 5.5 · medium');
  expect(repo.notes()).toBe('start\nstep 1\nstep 1\n');
});

test('Stop mid-Builder cancels the Builder and the crew', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Hands-off');
  await send(page, `${CREW_REQUEST} #build #crew #slowbuild`);
  const builder = agentHead(page, 'Bolt');
  await expect(builder).toContainText(/Working|Thinking/, { timeout: 30_000 });
  await expect.poll(() => repo.notes()).toContain('step 1');
  await page.getByRole('button', { name: 'Stop' }).click();

  await expect(builder).toContainText('Stopped', { timeout: 30_000 });
  await expect(builder.locator('.agent-ava')).toHaveClass(/\bstopped\b/);
  await expect(agentHead(page, 'Jev')).toContainText('Stopped');
  await expect(page.locator('.crew-turn .agent-state.failed')).toHaveCount(0);
  await expect(page.locator('.crew-foot')).toContainText('Done 2 agents');
  await expect(agentHead(page, 'Rivet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('an edited plan goes back to the Architect, and Stop on the new plan ends the turn', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, `${CREW_REQUEST} #build #crew`);
  const first = card(page, /Approve the plan/).first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.getByRole('button', { name: 'Edit' }).click();
  const editor = first.getByRole('textbox', { name: 'Edit the plan' });
  await expect(editor).toHaveValue(/- Update src\/turns\.ts for step 3$/);
  await editor.fill('Keep the divider untouched');
  await first.getByRole('button', { name: 'Send changes' }).click();
  await expect(first).toContainText('Sent your changes to the plan.');

  const second = card(page, /Approve the plan/).nth(1);
  await expect(second).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.crew-turn .agent-name', { hasText: /^Sketch$/ })).toHaveCount(2);
  await expect(agentBlock(page, 'Sketch').last()).toContainText(
    'Edited: Keep the divider untouched',
  );
  await second.getByRole('button', { name: 'Stop' }).click();
  await expect(second).toContainText('Stopped.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  await expect(agentHead(page, 'Bolt')).toHaveCount(0);
  expect(repo.notes()).toBe('start\n');
});

test('Fix from the keep card runs another Builder with your note', async ({ page }) => {
  test.setTimeout(60_000);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Fix the divider #build');
  await allowEdit(page);
  const keep = card(page, /Keep these changes\?/).first();
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await keep.getByRole('button', { name: 'Fix' }).click();
  await keep.getByRole('textbox', { name: 'What should be fixed?' }).fill('Cache the time zone');
  await keep.getByRole('button', { name: 'Ask for a fix' }).click();
  await expect(keep).toContainText('Asked for a fix.');

  await allowEdit(page);
  const again = card(page, /Keep these changes\?/).nth(1);
  await expect(again).toBeVisible({ timeout: 30_000 });
  await again.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('.crew-foot')).toContainText('Done 1 agent', { timeout: 30_000 });
  expect(repo.notes()).toBe('start\nstep 1\nstep 1\n');
});

async function autoContinueAfter(page: Page, seconds: number): Promise<void> {
  const response = await page.request.patch('/api/profile', {
    data: { autoContinueSeconds: seconds },
  });
  expect(response.ok()).toBe(true);
}

test('an unanswered Jev question counts down and continues with the rules', async ({ page }) => {
  test.setTimeout(60_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Tidy the heading #build #unsure');
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
  await crewChat(page, repo, 'Balanced');
  await send(page, 'Tidy the heading #build #unsure');
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
