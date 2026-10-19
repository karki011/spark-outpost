import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  calendarDaySchema,
  calendarNowSchema,
  calendarStatusSchema,
  joinOpen,
  spanOf,
  type CalendarEvent,
} from '../../packages/contracts/src/index.ts';
import { resetTestDatabase } from './database.ts';
import { island, openNotchIsland } from './island-notch-desktop.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { calendarCard, chooseCalendars } from './calendar-card.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

interface FakeCalendarState {
  authorization?: 'notDetermined' | 'denied' | 'restricted' | 'fullAccess';
  grant?: 'denied' | 'fullAccess';
  helper?: 'ready' | 'missing' | 'failed';
}

const MINUTE = 60_000;
let anchor = 0;

export function writeFakeCalendar(state: FakeCalendarState | null): void {
  if (state === null && anchor === 0) rmSync(FAKE_CALENDAR_STATE, { force: true });
  else writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ ...state, anchor }));
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const today = (page: Page) => page.getByRole('main', { name: 'Today' });
const event = (page: Page, title: string) =>
  today(page).getByRole('button', { name: new RegExp(`^${title}, `) });

async function status(page: Page) {
  const response = await page.request.get('/api/calendar/status');
  return calendarStatusSchema.parse(await response.json());
}

async function connect(page: Page, nudgeWork = true) {
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  for (const calendar of (await status(page)).accounts.flatMap((account) => account.calendars)) {
    const nudges = nudgeWork && calendar.title === 'Spark Work';
    await page.request.patch(`/api/calendar/calendars/${calendar.key}`, {
      data: { include: true, nudges },
    });
  }
}

async function todayEvents(page: Page): Promise<CalendarEvent[]> {
  const now = new Date(apiNow());
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const response = await page.request.get(`/api/calendar/day?date=${date}`);
  return calendarDaySchema.parse(await response.json()).events;
}

async function upcoming(page: Page) {
  const response = await page.request.get('/api/calendar/now');
  return calendarNowSchema.parse(await response.json()).upcoming;
}

async function openToday(page: Page) {
  await page.goto('/');
  await rail(page)
    .getByRole('button', { name: /^Today/ })
    .click();
  await expect(today(page)).toBeVisible();
}

async function openTodayDay(page: Page) {
  await openToday(page);
  await today(page).getByRole('radio', { name: 'Day' }).click();
  await expect(today(page).getByRole('group', { name: 'This week' })).toBeVisible();
}

async function recordOpens(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as unknown as { opened: string[] }).opened = opened;
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { opened: string[] }).opened);

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFakeCalendar(null);
  await matchApiClock(page);
  await page.request.post('/api/calendar/connect', { data: {} });
  await page.request.post('/api/calendar/disconnect', { data: {} });
});

test.afterAll(() => {
  anchor = 0;
  writeFakeCalendar(null);
});

test('connects from Today through the Calendar connector card', async ({ page }) => {
  writeFakeCalendar({ authorization: 'notDetermined' });
  await openToday(page);
  await expect(
    today(page).getByRole('heading', { name: 'See your day next to your chats' }),
  ).toBeVisible();
  await today(page).getByRole('button', { name: 'Connect calendar' }).click();
  const card = calendarCard(page);
  await expect(card).toContainText('Every calendar already on this Mac');
  await card.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(card).toContainText(/2 calendars( · next: .+)?/);
  await expect(card.getByRole('region', { name: 'Mac Calendar' })).toContainText('Connected');
  await expect(card.getByText('shared')).toBeVisible();
  const agents = card.getByRole('switch', { name: 'Let agents read my calendar' });
  await expect(agents).toBeEnabled();
  await expect(agents).toHaveAttribute('aria-checked', 'false');
  await expect(card.getByRole('switch', { name: 'Nudge, Spark Work' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(card).not.toContainText('Counts as busy');
  await chooseCalendars(page, 'Mac Calendar');
  await expect(card.getByRole('checkbox', { name: 'Include Spark Work' })).toBeChecked();
  await card.getByRole('checkbox', { name: 'Include Spark Family' }).uncheck();
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByRole('button', { name: 'Options for Mac Calendar' })).toBeFocused();
  await expect(card.getByRole('switch', { name: 'Nudge, Spark Family' })).toBeDisabled();
  await expect(card.getByRole('switch', { name: 'Nudge, Spark Family' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(card.getByText('hidden', { exact: true })).toBeVisible();
});

test('shows the denied state with Open Calendar settings', async ({ page }) => {
  writeFakeCalendar({ authorization: 'denied' });
  await openToday(page);
  await expect(today(page).getByRole('heading', { name: 'Calendars access is off' })).toBeVisible();
  const response = page.waitForResponse('**/api/calendar/open-settings');
  await today(page).getByRole('button', { name: 'Open Calendar settings' }).click();
  expect((await response).ok()).toBe(true);
});

test('shows the helper-missing state', async ({ page }) => {
  writeFakeCalendar({ helper: 'missing' });
  await openToday(page);
  await expect(
    today(page).getByRole('heading', { name: 'The calendar helper isn’t available' }),
  ).toBeVisible();
  await expect(today(page)).toContainText('pnpm desktop:calendar');
});

test('asks to choose calendars when none is included', async ({ page }) => {
  await connect(page, false);
  for (const calendar of (await status(page)).accounts.flatMap((account) => account.calendars)) {
    await page.request.patch(`/api/calendar/calendars/${calendar.key}`, {
      data: { include: false },
    });
  }
  await openToday(page);
  await expect(today(page).getByRole('heading', { name: 'No calendars included' })).toBeVisible();
  await today(page).getByRole('button', { name: 'Choose calendars' }).click();
  await expect(
    calendarCard(page).getByRole('checkbox', { name: 'Include Spark Work' }),
  ).not.toBeChecked();
});

test('merges both calendars, filters one out and shows another day', async ({ page }) => {
  await connect(page);
  await openTodayDay(page);
  await expect(today(page).getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(today(page)).toContainText(/(Heavy|Balanced|Light|Clear) day · meetings/);
  await expect(event(page, 'Shared invite')).toHaveCount(1);
  await expect(event(page, 'Shared invite')).toHaveAccessibleName(/also on Spark Family/);
  await expect(event(page, 'School pickup')).toBeVisible();
  await expect(
    today(page)
      .getByRole('list', { name: 'All day' })
      .getByRole('button', {
        name: /^Company holiday, all day/,
      }),
  ).toBeVisible();
  await expect(today(page).getByText('no gap: Microsoft Teams → Google Meet')).toBeVisible();

  const filters = today(page).getByRole('group', { name: 'Show calendars' });
  await filters.getByRole('button', { name: 'Spark Family' }).click();
  await expect(filters.getByRole('button', { name: 'Spark Family' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(event(page, 'School pickup')).toHaveCount(0);
  await expect(event(page, 'Shared invite')).toBeVisible();

  const week = today(page).getByRole('group', { name: 'This week' });
  const days = week.getByRole('button');
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true');
  await days.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(days.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(days.nth(1)).toBeFocused();
  await expect(event(page, 'Demo day')).toBeVisible();
  await expect(today(page).getByText('Join and the now line appear on the day')).toBeVisible();
  await event(page, 'Demo day').click();
  await expect(
    today(page).getByRole('button', { name: /^Demo day at \d+:\d+ [AP]M, Join opens at / }),
  ).toBeDisabled();
});

test('joins only an open meeting, from the panel and with ⌘J', async ({ page }) => {
  await recordOpens(page);
  await connect(page);
  const events = await todayEvents(page);
  const standup = events.find((item) => item.title === 'Standup')!;
  const customer = events.find((item) => item.title === 'Customer call')!;
  expect(joinOpen(spanOf(standup), apiNow())).toBe(true);
  expect(joinOpen(spanOf(customer), apiNow())).toBe(false);
  await openTodayDay(page);

  await event(page, 'Customer call').focus();
  await page.keyboard.press('Enter');
  await expect(event(page, 'Customer call')).toHaveAttribute('aria-expanded', 'true');
  const panel = today(page).getByRole('region', { name: 'Customer call' });
  const teams = panel.getByRole('button', {
    name: /^Customer call at \d+:\d+ [AP]M, Join opens at /,
  });
  await expect(teams).toBeDisabled();
  await expect(panel).toContainText('teams.microsoft.com, unwrapped from Outlook SafeLinks');

  await event(page, 'Standup').click();
  const join = today(page)
    .getByRole('region', { name: 'Standup' })
    .getByRole('button', { name: 'Join Zoom' });
  await join.click();
  expect(await opened(page)).toEqual(['https://acme.zoom.us/j/123456789']);
  await page.keyboard.press('ControlOrMeta+j');
  await expect.poll(() => opened(page)).toHaveLength(2);
});

test('the resting island names the next meeting and joins it', async ({ page }) => {
  await recordOpens(page);
  await connect(page);
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  const bubble = island(page).getByRole('group', { name: 'Meeting Standup' });
  await expect(bubble).toContainText(/^In [1-5] min\s*Standup/);
  await bubble.getByRole('button', { name: 'Join Zoom: Standup' }).click();
  await expect.poll(() => opened(page)).toEqual(['https://acme.zoom.us/j/123456789']);
});

test('sets Remind me and Hold alerts as Spark marks', async ({ page }) => {
  await connect(page);
  await openTodayDay(page);
  await event(page, 'Customer call').click();
  const panel = today(page).getByRole('region', { name: 'Customer call' });
  const remind = panel.getByRole('button', { name: /^Remind me 5 min before/ });
  const hold = panel.getByRole('button', { name: /^Hold alerts during this/ });
  await remind.click();
  await expect(remind).toHaveAttribute('aria-pressed', 'true');
  await hold.click();
  await expect(hold).toHaveAttribute('aria-pressed', 'true');
  await expect(event(page, 'Customer call')).toHaveAccessibleName(/alerts held, reminder/);
  await page.reload();
  await event(page, 'Customer call').click();
  await expect(remind).toHaveAttribute('aria-pressed', 'true');
  await hold.click();
  await expect(hold).toHaveAttribute('aria-pressed', 'false');
});

test('starts a prefilled New chat for an event and sends nothing', async ({ page }) => {
  await connect(page);
  await openTodayDay(page);
  await event(page, 'Standup').click();
  await today(page)
    .getByRole('button', { name: /^Start a chat for this/ })
    .click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Standup\n\nDaily sync: what changed since yesterday.');
  const chats = await page.request.get('/api/conversations');
  expect(await chats.json()).toEqual([]);
});

test('shows Upcoming and the calendar block beside the brief on Home', async ({ page }) => {
  await connect(page);
  const [failed] = await seedChats([
    { title: 'Mock fetch retries', run: { status: 'failed', error: 'Claude is rate limited.' } },
  ]);
  await decorateLatestRun(failed!, { provider: 'claude' });
  const next = await upcoming(page);
  expect(next.map((item) => item.title)).toEqual(['Standup', 'Customer call', 'Vendor sync']);
  await page.goto('/');
  const block = page.getByRole('region', { name: 'Today’s meetings' });
  await expect(block).toContainText('From your calendar · on this Mac, not sent to a model', {
    timeout: 15_000,
  });
  await expect(block).toContainText(/Longest free block|No free block/);
  const card = page.getByRole('region', { name: 'Upcoming' });
  await expect(card).toContainText('⌘J joins the next');
  await expect(card).toContainText('Standup');
  await expect(card.getByRole('button', { name: 'Join Standup' })).toBeEnabled();
  await expect(
    card.getByRole('button', { name: /^Customer call at \d+:\d+ [AP]M, Join opens at / }),
  ).toBeDisabled();
});

test('lists the calendar rows in Notifications and in Settings search', async ({ page }) => {
  await connect(page);
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('hold chimes');
  await expect(
    page.getByRole('listbox', { name: 'Matching settings' }).getByRole('option', {
      name: /^Hold chimes during/,
    }),
  ).toContainText('Mac · Notifications');
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.getByRole('radiogroup', { name: 'Hold chimes during' })).toBeVisible();
  for (const name of ['Before a meeting', 'Wrap-up reminder']) {
    await expect(dialog.getByRole('radiogroup', { name })).toBeVisible();
  }
  for (const name of [
    'Add today’s calendar to the brief',
    'Anything to capture?',
    'Meeting alerts on paired devices',
  ]) {
    await expect(dialog.getByRole('switch', { name })).toBeVisible();
  }
  await expect(
    dialog.getByRole('switch', { name: 'Meeting alerts on paired devices' }),
  ).toHaveAttribute('aria-checked', 'false');
  const names = dialog.getByRole('textbox', { name: 'Focus blocks are events named' });
  await expect(names).toHaveValue('Focus, Deep work, Heads down');
  await dialog
    .getByRole('radiogroup', { name: 'Before a meeting' })
    .getByRole('radio', { name: '15 min' })
    .click();
  await expect.poll(async () => (await status(page)).settings.beforeMinutes).toBe(15);
  const nudges = dialog.getByRole('group', { name: 'Calendars that nudge' });
  await expect(nudges.getByRole('switch', { name: 'Nudge, Spark Work' })).toBeVisible();
  await expect(nudges.getByRole('checkbox', { name: 'Include Spark Family' })).toBeVisible();
  await expect(nudges.getByRole('switch', { name: /Agents can edit/ })).toHaveCount(0);
  await expect(dialog).not.toContainText('Counts as busy');
  await expect(dialog).not.toContainText('Prepare meetings');
});

test('has no serious accessibility problems on Today', async ({ page }) => {
  await connect(page);
  await openTodayDay(page);
  await expect(today(page).getByRole('group', { name: 'This week' })).toBeVisible();
  const first = today(page).locator('.tl-ev').first();
  if (await first.count()) await first.click();
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});
