import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  GOOGLE_EDIT_DECLINED,
  GOOGLE_TESTING_LINE,
  calendarStatusSchema,
} from '../../packages/contracts/src/index.ts';
import { resetTestDatabase } from './database.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { GOOGLE_STUB_EMAIL } from './google-stub.ts';
import { FAKE_CALENDAR_STATE, STUB_PORT } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const SHOTS = process.env.CALENDAR_SHOTS ?? '';
const MINUTE = 60_000;
let anchor = 0;

const card = (page: Page) => page.locator('[data-connector="calendar"]');
const today = (page: Page) => page.getByRole('main', { name: 'Today' });

async function status(page: Page) {
  const response = await page.request.get('/api/calendar/status');
  return calendarStatusSchema.parse(await response.json());
}

async function forgetGoogle(page: Page) {
  for (const account of (await status(page)).google.accounts) {
    await page.request.delete(`/api/calendar/google/accounts/${account.id}`);
  }
}

async function seedGoogle(events: object[]) {
  await fetch(`${STUB_URL}/google-test/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(events),
  });
}

const iso = (minutes: number) => new Date(anchor + minutes * MINUTE).toISOString();

async function openCard(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await today(page).getByRole('button', { name: 'Connect calendar' }).click();
  await expect(card(page)).toBeVisible();
}

async function addGoogle(page: Page) {
  const popup = page.waitForEvent('popup');
  await card(page).getByRole('button', { name: 'Add Google account' }).click();
  const signIn = await popup;
  await expect(signIn.getByRole('heading', { name: 'You can close this tab' })).toBeVisible();
  await signIn.close();
  await expect(card(page).getByRole('region', { name: GOOGLE_STUB_EMAIL })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ authorization: 'notDetermined', anchor }));
  await resetTestDatabase({ onboarded: true });
  await forgetGoogle(page);
  await fetch(`${STUB_URL}/google-test/reset`);
  await matchApiClock(page);
});

test.afterEach(async ({ page }) => {
  await forgetGoogle(page);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('adds a Google account in the default browser and shows its events on Today', async ({
  page,
}) => {
  await seedGoogle([
    {
      id: 'review',
      iCalUID: 'review@google.com',
      summary: 'Design review',
      start: { dateTime: iso(30) },
      end: { dateTime: iso(60) },
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      attendees: [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'accepted' }],
    },
  ]);
  await openCard(page);
  await expect(card(page)).toContainText(GOOGLE_TESTING_LINE);
  await addGoogle(page);
  await expect(card(page)).toContainText('1 Google account · 1 of 1 calendar');
  await expect(
    card(page).getByRole('checkbox', { name: `Include ${GOOGLE_STUB_EMAIL}` }),
  ).toBeChecked();
  await expect(card(page).getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  const review = today(page).getByRole('button', { name: /^Design review, / });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.getByRole('button', { name: /Open in Google Calendar/ })).toBeVisible();
});

test('shows an event synced to macOS Calendar and Google once', async ({ page }) => {
  await seedGoogle([
    {
      id: 'standup',
      iCalUID: 'uid-standup',
      summary: 'Standup',
      start: { dateTime: iso(4) },
      end: { dateTime: iso(19) },
    },
  ]);
  await openCard(page);
  await card(page).getByRole('button', { name: 'Connect', exact: true }).click();
  await addGoogle(page);
  const now = new Date(apiNow());
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = await (await page.request.get(`/api/calendar/day?date=${date}`)).json();
  const standups = (day.events as { title: string; also: string[] }[]).filter(
    (event) => event.title === 'Standup',
  );
  expect(standups).toHaveLength(1);
  expect(standups[0]!.also).toHaveLength(1);
});

test('asks to sign in again when Google ends the sign-in, and Disconnect revokes it', async ({
  page,
}) => {
  await openCard(page);
  await addGoogle(page);
  await fetch(`${STUB_URL}/google-test/expire`);
  const include = card(page).getByRole('checkbox', { name: `Include ${GOOGLE_STUB_EMAIL}` });
  await include.uncheck();
  await include.check();
  await expect(
    card(page).getByRole('button', { name: 'Sign in again', exact: true }),
  ).toBeVisible();
  await expect(card(page)).toContainText('Google sign-in ran out');

  await card(page)
    .getByRole('button', { name: `Disconnect ${GOOGLE_STUB_EMAIL}` })
    .click();
  await expect(card(page).getByRole('region', { name: GOOGLE_STUB_EMAIL })).toHaveCount(0);
  const revoked = (await (await fetch(`${STUB_URL}/google-test/revoked`)).json()) as {
    issued: number;
    revoked: number;
  };
  expect(revoked.issued).toBe(revoked.revoked);
  expect((await status(page)).google.accounts).toEqual([]);
});

const LONG_GOOGLE =
  'Find out more about this very long subscribed calendar https://docs.google.com/drawings/d/1I-ChMlOhrqGjMPll4cO70WbRn2wjyZ9kTVBM30EX9nM/preview';
const LONG_MAC =
  'Family and friends shared calendar with a name far too long to fit on one line, holding every school run, birthday and weekend plan';

async function expectClipped(name: string, where: Locator) {
  const label = where.locator(`[title="${name}"]`).first();
  await expect(label).toHaveText(name);
  const box = await label.evaluate((element) => ({
    clipped: element.scrollWidth > element.clientWidth,
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) || 20,
  }));
  expect(box.clipped).toBe(true);
  expect(box.height).toBeLessThanOrEqual(box.lineHeight * 1.5);
}

test('cuts long macOS and Google calendar names to one line, with the full name kept', async ({
  page,
}) => {
  writeFileSync(
    FAKE_CALENDAR_STATE,
    JSON.stringify({ authorization: 'notDetermined', anchor, familyTitle: LONG_MAC }),
  );
  await fetch(`${STUB_URL}/google-test/calendar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'long@group.calendar.google.com', summary: LONG_GOOGLE }),
  });
  await openCard(page);
  await card(page).getByRole('button', { name: 'Connect', exact: true }).click();
  await addGoogle(page);
  await expectClipped(LONG_MAC, card(page));
  await expectClipped(LONG_GOOGLE, card(page));
  await expect(card(page).getByRole('checkbox', { name: `Include ${LONG_GOOGLE}` })).toBeChecked();

  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Today/ })
    .click();
  await today(page).getByRole('radio', { name: 'Day' }).click();
  const filters = today(page).getByRole('group', { name: 'Show calendars' });
  await expectClipped(LONG_MAC, filters);
  await expectClipped(LONG_GOOGLE, filters);
  await expect(filters.getByRole('button', { name: LONG_GOOGLE })).toBeVisible();
});

test('has no serious accessibility problems in the Calendar card with Google', async ({ page }) => {
  await openCard(page);
  await addGoogle(page);
  const results = await new AxeBuilder({ page }).include('[data-connector="calendar"]').analyze();
  expect(
    results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
  ).toEqual([]);
});

test('groups a Google account with one Nudge switch per row and folds a long list', async ({
  page,
}) => {
  for (const n of [1, 2, 3, 4, 5]) {
    await fetch(`${STUB_URL}/google-test/calendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `team${n}@group.calendar.google.com`, summary: `Team ${n}` }),
    });
  }
  await openCard(page);
  await addGoogle(page);
  const account = card(page).getByRole('region', { name: GOOGLE_STUB_EMAIL });
  await expect(account.getByRole('listitem')).toHaveCount(5);
  await expect(
    card(page)
      .getByRole('region', { name: 'Google Calendar' })
      .getByRole('button', { name: 'Add Google account' }),
  ).toBeVisible();
  await expect(account.getByRole('switch', { name: 'Nudge, Team 1' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(account).not.toContainText('Counts as busy');
  const more = account.getByRole('button', { name: 'Show 1 more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(account.getByRole('listitem')).toHaveCount(6);
  await account.getByRole('button', { name: 'Show fewer' }).click();
  await expect(account.getByRole('listitem')).toHaveCount(5);
  await account.getByRole('switch', { name: 'Nudge, Team 1' }).click();
  await expect
    .poll(async () => {
      const calendars = (await status(page)).accounts.flatMap((item) => item.calendars);
      return calendars.find((calendar) => calendar.title === 'Team 1')?.nudges;
    })
    .toBe(false);
});

async function allowEdit(page: Page, account: Locator) {
  const popup = page.waitForEvent('popup');
  await account.getByRole('switch', { name: `Agents can edit, ${GOOGLE_STUB_EMAIL}` }).click();
  const consent = await popup;
  await expect(consent.getByRole('heading', { name: 'You can close this tab' })).toBeVisible();
  await consent.close();
}

test('asks Google to allow editing only when Agents can edit is turned on', async ({ page }) => {
  await openCard(page);
  await addGoogle(page);
  expect((await status(page)).google.accounts[0]).toMatchObject({ canEdit: false });
  const account = card(page).getByRole('region', { name: GOOGLE_STUB_EMAIL });
  const edit = account.getByRole('switch', { name: `Agents can edit, ${GOOGLE_STUB_EMAIL}` });
  await expect(edit).toHaveAttribute('aria-checked', 'false');
  await allowEdit(page, account);
  await expect(edit).toHaveAttribute('aria-checked', 'true');
  expect((await status(page)).google.accounts[0]).toMatchObject({ canEdit: true });
  if (SHOTS) await account.screenshot({ path: `${SHOTS}/google-edit-allowed.png` });
  await edit.click();
  await expect(edit).toHaveAttribute('aria-checked', 'false');
  await edit.click();
  await expect(edit).toHaveAttribute('aria-checked', 'true');
});

test('keeps Agents can edit off with a note when Google doesn’t allow editing', async ({
  page,
}) => {
  await fetch(`${STUB_URL}/google-test/read-only`);
  await openCard(page);
  await addGoogle(page);
  const account = card(page).getByRole('region', { name: GOOGLE_STUB_EMAIL });
  await allowEdit(page, account);
  await expect(account.getByRole('alert')).toHaveText(GOOGLE_EDIT_DECLINED);
  const edit = account.getByRole('switch', { name: `Agents can edit, ${GOOGLE_STUB_EMAIL}` });
  await expect(edit).toHaveAttribute('aria-checked', 'false');
  await expect(account.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  expect((await status(page)).google.accounts[0]).toMatchObject({ canEdit: false });
  if (SHOTS) await account.screenshot({ path: `${SHOTS}/google-edit-declined.png` });
});
