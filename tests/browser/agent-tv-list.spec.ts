import { expect, test, type Page } from '@playwright/test';
import { toggleHeaderPane } from './header-menu.ts';
import {
  allowEdit,
  BUILD_REQUEST,
  card,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';

const ELAPSED = /^(\d+s|\d+m \d\ds|\d+h \d\dm)$/;

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tv-fresh')) return;
    sessionStorage.setItem('tv-fresh', '1');
    localStorage.removeItem('spark-outpost.agent-tv');
  });
});

test.afterEach(() => repo.remove());

const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const running = (page: Page) =>
  tvOf(page).getByRole('list', { name: 'Running' }).getByRole('listitem');

async function listWhileWaiting(page: Page) {
  await projectChat(page, repo, 'Ask before edits');
  await send(page, `${BUILD_REQUEST} #build`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
  return openList(page);
}

async function openList(page: Page) {
  await toggleHeaderPane(page, 'Agent TV');
  const tv = tvOf(page);
  await expect(tv).toBeVisible();
  await tv.getByRole('radio', { name: 'List' }).click();
  await expect(tv.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  return tv;
}

test('List view shows the running agent with a ticking clock, and the choice is remembered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const tv = await listWhileWaiting(page);
  await expect(tv.locator('.tv-stage')).toHaveCount(0);

  const row = running(page);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAccessibleName(/^Claude/);
  await expect(row).toContainText('Needs you');
  await expect(row.getByRole('button', { name: /^Stop / })).toBeVisible();

  const clock = row.locator('.tvl-clock');
  await expect(clock).toHaveText(ELAPSED);
  const before = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 4_000 }).not.toBe(before);

  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.agent-tv'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ view: 'list' });
  await page.reload();
  await toggleHeaderPane(page, 'Agent TV');
  await expect(tvOf(page).getByRole('radio', { name: 'List' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(running(page)).toHaveCount(1);
});

test('the view toggle works from the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const tv = await listWhileWaiting(page);
  const list = tv.getByRole('radio', { name: 'List' });
  await list.focus();
  await page.keyboard.press('ArrowLeft');
  const stage = tv.getByRole('radio', { name: 'Stage' });
  await expect(stage).toHaveAttribute('aria-checked', 'true');
  await expect(stage).toBeFocused();
  await expect(tv.locator('.tv-stage')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(list).toHaveAttribute('aria-checked', 'true');
  await expect(tv.locator('.tvl')).toBeVisible();
});

test('Needs you jumps to the approval, and Finished opens, shows the outcome and clears', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tv = await listWhileWaiting(page);
  const edit = card(page, /Change a file\?/);
  const needs = running(page).getByRole('button', { name: 'Needs you' });
  await expect(needs).toBeVisible({ timeout: 10_000 });
  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  await needs.click();
  await expect(edit).toBeInViewport();
  await allowEdit(page);
  await turnDone(page);

  const toggle = tv.getByRole('button', { name: /^Finished/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(tv.getByRole('list', { name: 'Finished' })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const finished = tv.getByRole('list', { name: 'Finished' }).getByRole('listitem');
  await expect(finished).toHaveCount(1);
  await expect(finished).toContainText('Passed');
  await expect(finished).toContainText(/\d+(\.\d)?s|\dm/);
  await expect(finished.getByRole('button', { name: /^Stop/ })).toHaveCount(0);

  await tv.getByRole('button', { name: 'Clear finished' }).click();
  await expect(toggle).toHaveCount(0);
  await expect(finished).toHaveCount(0);
});

test('Stop cancels the turn through the cancel endpoint', async ({ page }) => {
  test.setTimeout(60_000);
  await listWhileWaiting(page);
  const row = running(page);
  const runId = await row.getAttribute('data-run');
  expect(runId).toBeTruthy();
  const cancel = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/runs/${runId}/cancel`),
  );
  await row.getByRole('button', { name: /^Stop / }).click();
  await cancel;
  await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
});
