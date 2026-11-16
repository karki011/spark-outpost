import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const lead = (page: Page) => home(page).getByRole('group', { name: 'Meeting: Standup' });

function startEventsIn(minutes: number) {
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE + (minutes - 4) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor }));
}

async function openHomeInMeeting(page: Page, minutes: number) {
  startEventsIn(minutes);
  await matchApiClock(page);
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(home(page)).toBeVisible();
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('a meeting at its Join time sits beside the headline with Join, Snooze and Dismiss', async ({
  page,
}) => {
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await openHomeInMeeting(page, 4);

  await expect(lead(page)).toContainText('Standup');
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    /^Standup starts in [34] minutes\. 1 thing needs you first\.$/,
  );
  await expect(lead(page).getByRole('button', { name: 'Join Standup' })).toBeEnabled();
  await expect(lead(page).getByRole('button', { name: 'Snooze 1 min' })).toBeVisible();
  await expect(home(page).getByRole('region', { name: /^Needs you/ })).toContainText(
    'Deploy the site',
  );
});

test('Dismiss ends the meeting line for good', async ({ page }) => {
  await openHomeInMeeting(page, 4);
  await expect(lead(page)).toBeVisible();
  await lead(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(lead(page)).toHaveCount(0);
  const next = home(page).getByRole('button', { name: /^Next meeting: Standup/ });
  await expect(next).toHaveCount(0);
  await expect(home(page).getByRole('heading', { level: 1 })).not.toContainText('Standup');
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(lead(page)).toHaveCount(0);
  await expect(next).toHaveCount(0);
});

test('Snooze 1 min hides the line until the minute is up', async ({ page }) => {
  await openHomeInMeeting(page, 4);
  await lead(page).getByRole('button', { name: 'Snooze 1 min' }).click();
  await expect(lead(page)).toHaveCount(0);
  await expect(home(page).getByRole('button', { name: /^Next meeting: Standup/ })).toHaveCount(0);
  await page.clock.fastForward('01:10');
  await expect(lead(page)).toBeVisible();
});

test('a meeting outside its Join time shows as the next meeting and opens Today', async ({
  page,
}) => {
  await openHomeInMeeting(page, 25);
  await expect(lead(page)).toHaveCount(0);
  const next = home(page).getByRole('button', { name: /^Next meeting: Standup at / });
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.locator('.td-tools')).toBeVisible();
});
