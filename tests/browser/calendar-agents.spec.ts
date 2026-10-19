import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  SPARK_ACTION_OPTION,
  calendarStatusSchema,
  type CalendarEditAction,
} from '../../packages/contracts/src/index.ts';
import { resetTestDatabase } from './database.ts';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';
import { calendarCard, editCalendars } from './calendar-card.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const SHOTS = process.env.CALENDAR_SHOTS ?? '';
const MINUTE = 60_000;
const fakeNow = () => Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
const card = calendarCard;

async function status(page: Page) {
  const response = await page.request.get('/api/calendar/status');
  return calendarStatusSchema.parse(await response.json());
}

async function openCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const head = card(page).locator('button.pc-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(card(page).getByRole('switch', { name: 'Nudge, Spark Work' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const anchor = Math.floor(fakeNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ authorization: 'fullAccess', anchor }));
  await resetTestDatabase({ onboarded: true });
  const connected = await page.request.post('/api/calendar/connect', { data: {} });
  expect(connected.ok()).toBe(true);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('turns on agent reading and editing per calendar, off by default, and keeps them', async ({
  page,
}) => {
  await openCard(page);
  const read = card(page).getByRole('switch', { name: 'Let agents read my calendar' });
  await expect(read).toBeEnabled();
  await expect(read).toHaveAttribute('aria-checked', 'false');
  await editCalendars(page, 'Mac Calendar');
  const work = card(page).getByRole('switch', { name: 'Agents can edit, Spark Work' });
  const family = card(page).getByRole('switch', { name: 'Agents can edit, Spark Family' });
  await expect(work).toHaveAttribute('aria-checked', 'false');
  await expect(family).toHaveAttribute('aria-checked', 'false');
  await read.focus();
  await page.keyboard.press('Space');
  await expect(read).toHaveAttribute('aria-checked', 'true');
  await work.click();
  await expect(work).toHaveAttribute('aria-checked', 'true');
  await expect(work).toBeFocused();
  if (SHOTS) await card(page).screenshot({ path: `${SHOTS}/calendar-card-agents.png` });
  await page.reload();
  await openCard(page);
  await editCalendars(page, 'Mac Calendar');
  await expect(read).toHaveAttribute('aria-checked', 'true');
  await expect(work).toHaveAttribute('aria-checked', 'true');
  await expect(family).toHaveAttribute('aria-checked', 'false');
  const saved = await status(page);
  expect(saved.settings.agentsRead).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('[data-connector="calendar"]')
    .analyze();
  expect(scan.violations).toEqual([]);
});

function editAction(key: string): CalendarEditAction {
  const start = new Date(fakeNow() + 24 * 60 * MINUTE);
  start.setHours(11, 0, 0, 0);
  const at = (hours: number) => {
    const time = new Date(start);
    time.setHours(hours, 0, 0, 0);
    return time.toISOString();
  };
  return {
    action: 'calendar_edit',
    op: 'update',
    calendar: { key, title: 'Spark Family', account: 'iCloud', synced: true },
    eventId: 'pickup',
    occurrence: at(11),
    span: 'this',
    fields: { start: at(17), end: at(18) },
    before: {
      title: 'Design review',
      start: at(11),
      end: at(12),
      allDay: false,
      location: null,
      notes: null,
      alarmMinutes: null,
      others: 2,
      recurring: true,
    },
    after: {
      title: 'Design review',
      start: at(17),
      end: at(18),
      allDay: false,
      location: null,
      notes: null,
      alarmMinutes: null,
      others: 2,
      recurring: true,
    },
    floor: ['others', 'shared'],
  };
}

test('shows a calendar change before and after on its card', async ({ page }) => {
  const family = (await status(page)).accounts
    .flatMap((account) => account.calendars)
    .find((calendar) => calendar.title === 'Spark Family')!;
  await seedChats([
    {
      title: 'Plan the week',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'spark_action',
        title: 'Change this event? Design review',
        payload: {
          sparkAction: editAction(family.key),
          sparkResult: { state: 'waiting', message: null, url: null },
        },
        options: [
          { optionId: SPARK_ACTION_OPTION.confirm, name: 'Save change', kind: 'allow_once' },
          { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
        ],
      },
    },
  ]);
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: /^Plan the week/ })
    .click();
  const event = page.getByRole('group', { name: /Change this event\?/ });
  await expect(event).toBeVisible();
  await expect(event).toContainText('wants to change an event.');
  await expect(event).toContainText('Spark Family (iCloud)');
  await expect(event).toContainText(/When.*11:00 AM–12:00 PM.*→.*5:00–6:00 PM/);
  await expect(event).toContainText('This occurrence only');
  await expect(event).toContainText('2 other people, not told by Spark');
  await expect(event).toContainText('This event has other people, so Spark asks in every mode.');
  await expect(event).toContainText('The change syncs to this calendar’s server.');
  await expect(event.getByRole('button', { name: 'Save change' })).toBeVisible();
  await expect(event.getByRole('button', { name: 'Don’t' })).toBeVisible();
  if (SHOTS) await event.screenshot({ path: `${SHOTS}/calendar-edit-card.png` });
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.sac')
    .analyze();
  expect(scan.violations).toEqual([]);
});
