import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

const today = (page: Page) => page.getByRole('main', { name: 'Today' });
const week = (page: Page) => today(page).locator('.wk');
const days = (page: Page) => week(page).locator('.wk-day');

async function openWeek(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await today(page).getByRole('radio', { name: 'Week' }).click();
  await expect(week(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor }));
  await matchApiClock(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('shows the week as day columns, with weekends behind a switch that is kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openWeek(page);
  await expect(days(page)).toHaveCount(5);
  const weekends = today(page).getByRole('checkbox', { name: 'Show weekends' });
  await weekends.check();
  await expect(days(page)).toHaveCount(7);
  await expect(week(page).locator('.wk-day[aria-current="date"]')).toHaveCount(1);
  await expect(week(page).getByRole('button', { name: /^Standup, / })).toBeVisible();
  await page.reload();
  await expect(days(page)).toHaveCount(7);
  const results = await new AxeBuilder({ page }).include('.wk-page').analyze();
  expect(results.violations).toEqual([]);
  if (process.env.SPARK_WEEK_SHOT) {
    await page.screenshot({ path: `${process.env.SPARK_WEEK_SHOT}-light.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${process.env.SPARK_WEEK_SHOT}-dark.png` });
  }
});

test('an event opens its popover and Esc returns focus to it', async ({ page }) => {
  await openWeek(page);
  await today(page).getByRole('checkbox', { name: 'Show weekends' }).check();
  const standup = week(page).getByRole('button', { name: /^Standup, / });
  await standup.click();
  const popover = page.getByRole('dialog');
  await expect(popover).toContainText('Standup');
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(standup).toBeFocused();
});

test('steps a week at a time and a day header opens Day', async ({ page }) => {
  await openWeek(page);
  const first = await days(page).first().getAttribute('aria-label');
  await today(page).getByRole('button', { name: 'Next week' }).click();
  await expect(days(page).first()).not.toHaveAttribute('aria-label', first ?? '');
  await today(page).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(days(page).first()).toHaveAttribute('aria-label', first ?? '');
  await days(page).first().click();
  await expect(today(page).getByRole('radio', { name: 'Day' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
