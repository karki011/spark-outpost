import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  allowEdit,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = process.env.TV_LIST_SHOTS ?? '';
const ELAPSED = /^(\d+s|\d+m \d\ds|\d+h \d\dm)$/;

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
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
const row = (page: Page, name: RegExp) => running(page).and(page.getByRole('listitem', { name }));
const BUILDER = / · Builder$/;

async function listWaiting(page: Page) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
  return openList(page);
}

async function openList(page: Page) {
  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = tvOf(page);
  await expect(tv).toBeVisible();
  await tv.getByRole('radio', { name: 'List' }).click();
  await expect(tv.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  return tv;
}

test('List view shows running agents with a ticking clock, and the choice is remembered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const tv = await listWaiting(page);
  await expect(tv.locator('.tv-stage')).toHaveCount(0);

  const builder = row(page, BUILDER);
  await expect(builder).toBeVisible();
  await expect(running(page).first()).toContainText('Needs you');
  await expect(builder).toContainText('Agent');
  await expect(builder).toContainText('Opus 5.5');
  await expect(builder.getByRole('button', { name: /^Stop / })).toBeVisible();

  const clock = builder.locator('.tvl-clock');
  await expect(clock).toHaveText(ELAPSED);
  const before = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 4_000 }).not.toBe(before);

  const saved = await page.evaluate(() => localStorage.getItem('spark-outpost.agent-tv'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ view: 'list' });
  await page.reload();
  await page.getByRole('button', { name: 'Agent TV' }).click();
  await expect(tvOf(page).getByRole('radio', { name: 'List' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(row(page, BUILDER)).toBeVisible();
});

test('the view toggle works from the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const tv = await listWaiting(page);
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

test('Needs you jumps to the approval, and Finished opens, shows outcomes and clears', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tv = await listWaiting(page);
  const edit = card(page, /Change a file\?/);
  const needs = row(page, BUILDER).getByRole('button', { name: 'Needs you' });
  await expect(needs).toBeVisible({ timeout: 10_000 });
  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  await needs.click();
  await expect(edit).toBeInViewport();
  await allowEdit(page);
  await expect(tv.getByRole('button', { name: /^Finished/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.crew-foot').last()).toContainText('Done', { timeout: 30_000 });

  const toggle = tv.getByRole('button', { name: /^Finished/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(tv.getByRole('list', { name: 'Finished' })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const finished = tv.getByRole('list', { name: 'Finished' });
  const builder = finished.getByRole('listitem', { name: BUILDER });
  await expect(builder).toContainText('Passed');
  await expect(builder).toContainText(/\d+(\.\d)?s|\dm/);
  await expect(builder.getByRole('button', { name: /^Stop/ })).toHaveCount(0);

  if (SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((dark) => {
        if (dark) document.documentElement.dataset.skin = 'graphite';
        else delete document.documentElement.dataset.skin;
      }, scheme === 'dark');
      await page.waitForTimeout(400);
      await tv.screenshot({ path: path.join(SHOTS, `agent-tv-list-${scheme}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'agent-tv-list-narrow.png') });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  await tv.getByRole('button', { name: 'Clear finished' }).click();
  await expect(toggle).toHaveCount(0);
  await expect(finished).toHaveCount(0);
});

test('Stop cancels that agent through the existing cancel endpoint', async ({ page }) => {
  test.setTimeout(60_000);
  await listWaiting(page);
  const builder = row(page, BUILDER);
  const runId = await builder.getAttribute('data-run');
  expect(runId).toBeTruthy();
  const cancel = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/runs/${runId}/cancel`),
  );
  await builder.getByRole('button', { name: /^Stop / }).click();
  await cancel;
  await expect(row(page, BUILDER)).toHaveCount(0, {
    timeout: 15_000,
  });
});
