import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { FAKE_CALENDAR_FAR_DAYS, FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function dayKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

const today = (page: Page) => page.getByRole('main', { name: 'Today' });
const grid = (page: Page) => today(page).getByRole('grid');
const cell = (page: Page, at: number) => grid(page).locator(`[data-date="${dayKey(at)}"]`);
const scheduled = (page: Page) => today(page).getByRole('complementary', { name: 'Scheduled' });

async function openToday(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await expect(grid(page)).toBeVisible();
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

test('opens on the month with today selected and its events in the Scheduled rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openToday(page);
  await expect(today(page).getByRole('radio', { name: 'Month' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const now = apiNow();
  await expect(cell(page, now)).toHaveAttribute('aria-current', 'date');
  await expect(cell(page, now)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, now)).toHaveAttribute('tabindex', '0');
  await expect(cell(page, now)).toHaveAccessibleName(/today, \d+ events: Company holiday/);
  await expect(cell(page, now).locator('.mo-more')).toHaveText(/^\d+ more$/);
  await expect(cell(page, now - 6 * DAY)).toHaveAttribute('data-past');

  const standup = scheduled(page).locator('.rl-card', { hasText: 'Standup' });
  await expect(standup).toContainText('Daily sync: what changed since yesterday.');
  const people = standup.getByRole('list', { name: 'People' });
  await expect(people.getByRole('listitem')).toHaveText(['AWAlex Wong', 'IMIvan Marsh']);
  await expect(standup).not.toContainText('Spark Tester');
  await expect(standup.getByRole('button', { name: 'Join Zoom Standup' })).toBeEnabled();
  const customer = scheduled(page).locator('.rl-card', { hasText: 'Customer call' });
  await expect(
    customer.getByRole('button', { name: 'Join Microsoft Teams Customer call' }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(customer).toContainText(/Opens at \d+:\d+ [AP]M/);
});

test('moves across days with the arrows, crosses months and opens a day with Enter', async ({
  page,
}) => {
  await openToday(page);
  const now = apiNow();
  await cell(page, now).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, now + DAY)).toBeFocused();
  await expect(cell(page, now + DAY)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, now)).toHaveAttribute('tabindex', '-1');
  await expect(scheduled(page).locator('.rl-card', { hasText: 'Demo day' })).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('PageDown');
  const next = new Date(now);
  next.setMonth(next.getMonth() + 1);
  await expect(today(page).getByRole('heading', { level: 1 })).toContainText(
    next.toLocaleDateString(undefined, { month: 'long' }),
  );
  await expect(grid(page).locator('[aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(cell(page, now)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(today(page).getByRole('radio', { name: 'Day' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(today(page).getByRole('group', { name: 'This week' })).toBeVisible();
});

test('steps the rail by day and opens the event popover, which Esc closes', async ({ page }) => {
  await openToday(page);
  const now = apiNow();
  await scheduled(page).getByRole('button', { name: 'Next day' }).click();
  await expect(cell(page, now + DAY)).toHaveAttribute('aria-selected', 'true');
  await scheduled(page).getByRole('button', { name: 'Previous day' }).click();

  const opener = scheduled(page).getByRole('button', { name: /^Standup, / });
  await opener.click();
  const popover = page.getByRole('dialog', { name: 'Standup' });
  await expect(popover).toBeFocused();
  await expect(popover.getByRole('button', { name: 'Join Zoom Standup' })).toBeEnabled();
  for (const name of [
    /^Open in Calendar/,
    /^Start a chat for this/,
    /^Remind me 5 min before/,
    /^Hold alerts during this/,
  ]) {
    await expect(popover.getByRole('button', { name })).toBeVisible();
  }
  await expect(popover.getByRole('list', { name: 'People' })).toContainText('Alex Wong');
  await expect(popover).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Shift+Tab');
  await expect(popover.getByRole('button', { name: /^Hold alerts during this/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(popover.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(popover.getByRole('button', { name: /^Hold alerts during this/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(opener).toBeFocused();

  await scheduled(page).getByRole('button', { name: 'Open in Day view' }).click();
  await expect(today(page).getByRole('group', { name: 'This week' })).toBeVisible();
});

test('reads past months through the range and mutes past days', async ({ page }) => {
  await openToday(page);
  const now = apiNow();
  const past = now - FAKE_CALENDAR_FAR_DAYS * DAY;
  if (new Date(past).getMonth() !== new Date(now).getMonth()) {
    const range = page.waitForResponse((response) =>
      response.url().includes('/api/calendar/range?'),
    );
    await today(page).getByRole('button', { name: 'Previous month' }).click();
    expect((await range).ok()).toBe(true);
  }
  await expect(cell(page, past)).toHaveAttribute('data-past');
  await expect(cell(page, past)).toContainText('Quarterly review');
  await cell(page, past).click();
  const review = scheduled(page).locator('.rl-card', { hasText: 'Quarterly review' });
  await expect(review).toHaveAttribute('data-past');
  await today(page).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(cell(page, apiNow())).toHaveAttribute('aria-selected', 'true');
});

test('keeps Day across a reload in the same session', async ({ page }) => {
  await openToday(page);
  await today(page).getByRole('radio', { name: 'Day' }).click();
  await page.reload();
  await expect(today(page).getByRole('radio', { name: 'Day' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('fills the window and shows more titles per day when the window is taller', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 720 });
  await openToday(page);
  const now = apiNow();
  await expect(cell(page, now).locator('.mo-ev').first()).toBeVisible();
  const short = await cell(page, now).locator('.mo-ev').count();
  const page720 = await today(page).boundingBox();
  const layout = await today(page).locator('.mo-layout').boundingBox();
  expect(layout!.width).toBeGreaterThan(page720!.width - 80);

  await page.setViewportSize({ width: 1400, height: 1300 });
  await expect.poll(() => cell(page, now).locator('.mo-ev').count()).toBeGreaterThan(short);
  const rail = await scheduled(page).boundingBox();
  expect(rail!.width).toBeGreaterThanOrEqual(340);
  expect(rail!.width).toBeLessThanOrEqual(362);
});

test('picks a month and year from the title with the keyboard', async ({ page }) => {
  await openToday(page);
  const now = new Date(apiNow());
  const title = today(page).getByRole('heading', { level: 1 }).getByRole('button');
  await title.focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Choose month' });
  const current = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  await expect(picker.getByRole('button', { name: current })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(title).toBeFocused();

  await page.keyboard.press('Enter');
  await picker.getByRole('button', { name: 'Next year' }).click();
  const target = new Date(now.getFullYear() + 1, 0, 1);
  await picker.getByRole('button', { name: `January ${now.getFullYear() + 1}` }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(title).toBeFocused();
  target.setMonth(1);
  await expect(title).toHaveText(
    target.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );
});

test('keeps the month inside a phone-width window', async ({ page }) => {
  await openToday(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(grid(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  const gridBox = await grid(page).boundingBox();
  expect(gridBox!.x + gridBox!.width).toBeLessThanOrEqual(375);
});

test('stacks the rail under the grid at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await openToday(page);
  const gridBox = await today(page).locator('.mo-panel').boundingBox();
  const railBox = await scheduled(page).boundingBox();
  expect(railBox!.y).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('has no serious accessibility problems on the month with the popover open', async ({
  page,
}) => {
  await openToday(page);
  await scheduled(page)
    .getByRole('button', { name: /^Standup, / })
    .click();
  await expect(page.getByRole('dialog', { name: 'Standup' })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});
