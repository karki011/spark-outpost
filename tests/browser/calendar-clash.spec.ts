import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, fakeState, island, openHome, openIsland } from './island-home-desktop.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const MEETING_TUNE_NOTES = 4;

async function connect(page: Page) {
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
}

async function recordOpens(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);
const choose = (page: Page) => island(page).getByRole('region', { name: 'Choose a meeting' });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor, clash: true }));
  await matchApiClock(page);
  await connect(page);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('meetings that start together get one line, one hop and one tune', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fake-island-sound', 'on'));
  await fakeHomeDesktop(page);
  await openIsland(page);
  const scout = island(page).locator('.isl-scout-wrap svg.scout');
  await expect(scout).toHaveClass(/\bhappy\b/);
  await expect(scout).not.toHaveClass(/\bhappy\b/, { timeout: 5_000 });
  expect((await fakeState(page)).chimes).toBe(MEETING_TUNE_NOTES);
});

test('Choose lists each meeting with its own Join or Open, and Esc closes it', async ({ page }) => {
  await recordOpens(page);
  await fakeHomeDesktop(page, 'graphite', false);
  await openIsland(page);
  const line = island(page).locator('.isl-calline');
  await expect(line).toContainText(
    /^Meetings in \d+ min · Standup \+ 2 more\d+:\d+( [AP]M)?–\d+:\d+ [AP]M · Choose one/,
  );
  await expect(line.getByRole('button', { name: /^Join/ })).toHaveCount(0);
  await line.getByRole('button', { name: 'Choose one of 3 meetings' }).click();
  const list = choose(page);
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('button', { name: 'Join Standup' })).toBeFocused();
  await expect(list.getByRole('button', { name: 'Join Design sync' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Open Room booking' })).toBeVisible();
  await expect(list).toContainText('Spark Family');
  expect(await opened(page)).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(list.getByRole('button', { name: 'Join Design sync' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => opened(page)).toEqual(['https://meet.google.com/abc-defg-hij']);
  await page.evaluate(() => (window as unknown as { islandEscape: () => void }).islandEscape());
  await expect(choose(page)).toHaveCount(0);
});

test('the island list tags meetings that clash', async ({ page }) => {
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const list = island(page).getByRole('region', { name: 'Next meetings' });
  await expect(list.getByRole('listitem').first()).toContainText('clashes with 2 meetings');
  await expect(list.getByRole('listitem').nth(1)).toContainText('clashes with 2 meetings');
});

test('⌘J opens Choose when several meetings are open to join, and joins nothing', async ({
  page,
}) => {
  await recordOpens(page);
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Upcoming' });
  await expect(card).toContainText('clashes with 2 meetings', { timeout: 15_000 });
  await page.keyboard.press('ControlOrMeta+j');
  const dialog = page.getByRole('dialog', { name: 'Choose a meeting' });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((element) => getComputedStyle(element.parentElement!).position),
  ).toBe('fixed');
  await expect(dialog.getByRole('button', { name: 'Join Standup' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Open Room booking' })).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await opened(page)).toEqual([]);
  await page.keyboard.press('ControlOrMeta+j');
  await page
    .getByRole('dialog', { name: 'Choose a meeting' })
    .getByRole('button', { name: 'Open Room booking' })
    .click();
  const today = page.getByRole('main', { name: 'Today' });
  await expect(today.getByRole('region', { name: 'Room booking' })).toBeVisible();
});

test('Today tags clashing meetings on the timeline and in the event panel', async ({ page }) => {
  await page.goto('/');
  await rail(page)
    .getByRole('button', { name: /^Today/ })
    .click();
  const today = page.getByRole('main', { name: 'Today' });
  await today.getByRole('radio', { name: 'Day' }).click();
  const customer = today.getByRole('button', { name: /^Customer call, / });
  await expect(customer).toHaveAccessibleName(/clashes with Vendor sync/);
  await expect(customer.locator('.tl-tags')).toBeVisible();
  const standup = today.getByRole('button', { name: /^Standup, / });
  await expect(standup).toHaveAccessibleName(/clashes with 2 meetings/);
  await expect(standup.locator('.tl-tags')).toBeHidden();
  await expect(standup.locator('.tl-clash')).toHaveAttribute('title', /^Clashes with /);
  await customer.click();
  await expect(today.getByRole('region', { name: 'Customer call' })).toContainText(
    'clashes with Vendor sync',
  );
});
