import { expect, test, type Page, type Route } from '@playwright/test';
import {
  CALENDAR_DEFAULT_SETTINGS,
  type CalendarStatus,
  type GoogleSignInFlow,
} from '../../packages/contracts/src/index.ts';
import { calendarCard } from './calendar-card.ts';
import { resetTestDatabase } from './database.ts';
import { openSettingsTab } from './rail-menu.ts';

const card = calendarCard;
const ACCOUNT = '2f0b8c1e-6a4d-4e7b-9c3f-5a1d2e3f4b6c';
const CHOICE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EMAIL = 'owner@contoso.com';
const AUTHORIZE = 'http://127.0.0.1/fake-microsoft-authorize';
const IDLE: GoogleSignInFlow = {
  status: 'idle',
  authorizeUrl: null,
  expiresAt: null,
  message: null,
};

interface Fake {
  status: CalendarStatus;
  flow: GoogleSignInFlow;
  starts: number;
}

function baseStatus(helper: CalendarStatus['helper'], microsoft: boolean): CalendarStatus {
  return {
    supported: true,
    helper,
    authorization: helper === 'ready' ? 'notDetermined' : null,
    connected: false,
    accounts: [],
    notice: null,
    settings: CALENDAR_DEFAULT_SETTINGS,
    google: { available: true, testing: false, accounts: [], signIn: IDLE },
    microsoft: { available: microsoft, accounts: [], signIn: IDLE },
  };
}

function signedIn(status: CalendarStatus): CalendarStatus {
  return {
    ...status,
    accounts: [
      {
        id: `microsoft:${ACCOUNT}`,
        title: EMAIL,
        kind: 'microsoft',
        calendars: [
          {
            key: CHOICE,
            calendarId: `microsoft:${ACCOUNT}:AAMkCal`,
            title: 'Calendar',
            sourceId: `microsoft:${ACCOUNT}`,
            sourceTitle: EMAIL,
            sourceKind: 'microsoft',
            color: '#0078d4',
            writable: true,
            subscribed: false,
            ownership: 'mine',
            include: true,
            nudges: true,
            agentsEdit: false,
          },
        ],
      },
    ],
    microsoft: {
      ...status.microsoft,
      accounts: [
        {
          id: ACCOUNT,
          email: EMAIL,
          state: 'ready',
          message: null,
          canEdit: false,
          syncedAt: new Date().toISOString(),
        },
      ],
    },
  };
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeCalendar(page: Page, status: CalendarStatus): Promise<Fake> {
  const fake: Fake = { status, flow: IDLE, starts: 0 };
  await page.route('**/api/calendar/status', (route) => json(route, fake.status));
  await page.route('**/api/calendar/microsoft/sign-in', (route) => {
    if (route.request().method() !== 'POST') return json(route, fake.flow);
    fake.starts += 1;
    fake.flow = {
      status: 'waiting',
      authorizeUrl: AUTHORIZE,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      message: null,
    };
    return json(route, fake.flow);
  });
  await page
    .context()
    .route('**/fake-microsoft-authorize', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Microsoft sign-in</h1>' }),
    );
  return fake;
}

async function openCard(page: Page) {
  await page.goto('/');
  await openSettingsTab(page, 'Connectors');
  const head = card(page).locator('button.pc-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(card(page).locator('.cal-body')).toBeVisible();
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Windows: no Mac Calendar, Google and Microsoft offered, Microsoft signs in', async ({
  page,
}) => {
  const fake = await fakeCalendar(page, baseStatus('unsupported', true));
  await openCard(page);
  await expect(card(page).getByRole('region', { name: 'Mac Calendar' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  const tile = card(page).getByRole('region', { name: 'Microsoft 365 or Outlook.com' });
  await expect(tile).toContainText('Works without the Mac Calendar app.');

  const popup = page.waitForEvent('popup');
  await tile.getByRole('button', { name: 'Sign in with Microsoft' }).click();
  const signIn = await popup;
  await expect(signIn.getByRole('heading', { name: 'Microsoft sign-in' })).toBeVisible();
  await signIn.close();
  expect(fake.starts).toBe(1);
  const waiting = card(page).getByRole('group', { name: 'Microsoft sign-in' });
  await expect(waiting.getByRole('status')).toHaveText('Waiting for you to finish in Microsoft');
  await expect(waiting.getByRole('link', { name: /Open Microsoft again/ })).toBeVisible();

  fake.status = signedIn(fake.status);
  fake.flow = { ...IDLE, status: 'connected' };
  await expect(card(page).getByRole('region', { name: EMAIL })).toBeVisible();
  await card(page).getByRole('button', { name: 'Add calendar' }).click();
  await expect(page.getByRole('menuitem', { name: 'Microsoft 365 or Outlook.com' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Google Calendar' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Mac Calendar' })).toHaveCount(0);
});

test('Mac without a Microsoft app: the Microsoft option stays hidden', async ({ page }) => {
  await fakeCalendar(page, baseStatus('ready', false));
  await openCard(page);
  await expect(card(page).getByRole('region', { name: 'Mac Calendar' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Sign in with Microsoft' })).toHaveCount(0);
});

test('a build with no sign-ins on Windows says so instead of an empty card', async ({ page }) => {
  const status = baseStatus('unsupported', false);
  await fakeCalendar(page, { ...status, google: { ...status.google, available: false } });
  await openCard(page);
  await expect(card(page)).toContainText(
    'This build has no calendar sign-in set up for this computer.',
  );
  await expect(card(page).getByRole('button', { name: /Sign in with/ })).toHaveCount(0);
});
