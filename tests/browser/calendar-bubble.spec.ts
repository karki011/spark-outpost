import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { calendarNowSchema, calendarRangeSchema } from '../../packages/contracts/src/index.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { island, openNotchIsland } from './island-notch-desktop.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const bubble = (page: Page) => island(page).getByRole('group', { name: 'Meeting Standup' });
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

function dayKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

async function recordDesktop(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
    const desktop = (window as unknown as { sparkDesktop?: { island?: Record<string, unknown> } })
      .sparkDesktop;
    if (desktop?.island) {
      desktop.island.openSettings = (target: string) => opened.push(`settings:${target}`);
    }
  });
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);

async function eventKeyOf(page: Page, title: string, from: number, to: number) {
  const response = await page.request.get(
    `/api/calendar/range?from=${dayKey(from)}&to=${dayKey(to)}`,
  );
  const range = calendarRangeSchema.parse(await response.json());
  return range.events.find((event) => event.title === title)!.key;
}

async function fakeMainDesktop(page: Page) {
  await page.addInitScript(() => {
    const none = () => () => undefined;
    Object.assign(window, {
      sparkDesktop: {
        platform: 'darwin',
        island: { geometry: async () => null, onGeometry: none, onCommand: none },
        onOpenChat: none,
        onOpenSettings: (callback: (target: string) => void) => {
          Object.assign(window, { openFromIsland: callback });
          return () => undefined;
        },
      },
    });
  });
}

const openFromIsland = (page: Page, target: string) =>
  page.evaluate(
    (value) => (window as unknown as { openFromIsland: (t: string) => void }).openFromIsland(value),
    target,
  );

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

test('the meeting card hangs from Scout with its details, snoozes through a reload and opens Today for good', async ({
  page,
}) => {
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await recordDesktop(page);
  await page.reload();
  await expect(bubble(page)).toContainText(/^In [1-5] min\s*Standup/);
  await expect(bubble(page)).toContainText(/\d+:\d{2}( [AP]M)?–\d+:\d{2} [AP]M · 15 min/);
  await expect(bubble(page)).toContainText('Zoom · Spark Work');
  await expect(bubble(page)).toContainText('Alex Wong, Ivan Marsh');
  await expect(bubble(page)).toContainText('Daily sync: what changed since yesterday.');
  await expect(bubble(page).getByRole('button', { name: 'Join Zoom: Standup' })).toBeEnabled();

  const response = await page.request.get('/api/calendar/now');
  const meeting = calendarNowSchema
    .parse(await response.json())
    .upcoming.find((event) => event.title === 'Standup')!;
  await bubble(page).getByRole('button', { name: 'Snooze until start' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('spark-outpost.calendar-snoozes') ?? '[]'),
      ),
    )
    .toContainEqual([meeting.key, Date.parse(meeting.end), Date.parse(meeting.start)]);
  await expect(bubble(page)).toBeHidden();
  await page.reload();
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1_000);
  await expect(bubble(page)).toBeHidden();
  await page.evaluate(() => localStorage.removeItem('spark-outpost.calendar-snoozes'));
  await page.reload();
  await expect(bubble(page)).toBeVisible();

  await bubble(page).getByRole('button', { name: 'Open' }).click();
  const standup = await eventKeyOf(page, 'Standup', apiNow(), apiNow() + DAY);
  await expect.poll(() => opened(page)).toEqual([`settings:today:${standup}`]);
  await expect(bubble(page)).toBeHidden();
  await page.reload();
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1_000);
  await expect(bubble(page)).toBeHidden();
});

async function undismiss(page: Page) {
  const response = await page.request.get('/api/calendar/now');
  const standup = calendarNowSchema
    .parse(await response.json())
    .upcoming.find((event) => event.title === 'Standup')!;
  const reset = await page.request.put('/api/calendar/marks', {
    data: { eventKey: standup.key, end: standup.end, kind: 'dismiss', on: false },
  });
  expect(reset.ok()).toBe(true);
}

async function dismissedNow(page: Page): Promise<boolean | undefined> {
  const response = await page.request.get('/api/calendar/now');
  return calendarNowSchema
    .parse(await response.json())
    .upcoming.find((event) => event.title === 'Standup')?.dismissed;
}

test('Dismiss, × and Esc dismiss that meeting for good, even after a reload', async ({ page }) => {
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await expect(bubble(page)).toBeVisible();
  await bubble(page).getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(bubble(page)).toBeHidden();
  await expect.poll(() => dismissedNow(page)).toBe(true);
  await page.reload();
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await page.waitForTimeout(1_000);
  await expect(bubble(page)).toBeHidden();

  await undismiss(page);
  await page.reload();
  await bubble(page).getByRole('button', { name: 'Dismiss the nudge for Standup' }).click();
  await expect(bubble(page)).toBeHidden();
  await expect.poll(() => dismissedNow(page)).toBe(true);

  await undismiss(page);
  await page.reload();
  await bubble(page).getByRole('button', { name: 'Dismiss the nudge for Standup' }).focus();
  await page.keyboard.press('Escape');
  await expect(bubble(page)).toBeHidden();
  await expect.poll(() => dismissedNow(page)).toBe(true);
});

test('Open from the island lands on that day with the meeting selected and in view', async ({
  page,
}) => {
  await fakeMainDesktop(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  const tomorrow = apiNow() + DAY;
  const demo = await eventKeyOf(page, 'Demo day', tomorrow, tomorrow + DAY);
  await openFromIsland(page, `today:${demo}`);
  await expect(today(page).getByRole('radio', { name: 'Day' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const block = today(page).getByRole('button', { name: /^Demo day, / });
  await expect(block).toHaveAttribute('aria-expanded', 'true');
  await expect(block).toBeInViewport();
  await expect(today(page).getByRole('region', { name: 'Demo day' })).toBeVisible();

  await today(page).getByRole('radio', { name: 'Month' }).click();
  await today(page).getByRole('button', { name: 'Today', exact: true }).click();
  await today(page).getByRole('radio', { name: 'Day' }).click();
  await expect(today(page).getByRole('heading', { name: 'Select an event' })).toBeVisible();
  await expect(today(page).getByText('This event is no longer on your calendar.')).toHaveCount(0);

  await openFromIsland(page, `today:gone@${new Date(apiNow()).toISOString()}`);
  await expect(today(page).getByRole('status')).toHaveText(
    'This event is no longer on your calendar.',
  );
});

test('a row in Home Your day opens Today on that meeting', async ({ page }) => {
  const response = await page.request.get('/api/calendar/now');
  const upcoming = calendarNowSchema.parse(await response.json()).upcoming;
  expect(upcoming.map((event) => event.title)).toContain('Customer call');
  await page.goto('/');
  await page
    .getByRole('region', { name: /^(Your day|After the meeting)$/ })
    .getByRole('button', { name: 'Open Customer call in Today' })
    .click();
  const block = today(page).getByRole('button', { name: /^Customer call, / });
  await expect(block).toHaveAttribute('aria-expanded', 'true');
  await expect(today(page).getByRole('region', { name: 'Customer call' })).toBeVisible();
});
