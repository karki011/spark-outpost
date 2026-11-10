import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiNow, matchApiClock, setPageClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const lead = (page: Page) => home(page).getByRole('region', { name: 'Standup' });

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

test('a meeting at its Join time leads Home with what stalls and what is still working', async ({
  page,
}) => {
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
    { title: 'Filter chips overflow', run: { status: 'running' } },
  ]);
  await openHomeInMeeting(page, 4);

  await expect(lead(page).getByRole('heading', { level: 2 })).toHaveText('Standup');
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(
    /^Standup starts in [34] minutes\. 1 thing needs you first\.$/,
  );
  await expect(lead(page).getByRole('button', { name: 'Join Standup' })).toBeEnabled();
  const stall = lead(page).getByRole('group', { name: 'Will stall without you' });
  await expect(stall).toContainText('Deploy the site');
  await expect(stall.getByRole('button', { name: 'Open chat: Deploy the site' })).toBeVisible();
  const working = lead(page).getByRole('group', { name: 'Still working' });
  await expect(working).toContainText('Filter chips overflow');
  const after = home(page).getByRole('region', { name: 'After the meeting' });
  await expect(after).toBeVisible();
  await expect(after.locator('.hrow', { hasText: 'Standup' })).toHaveCount(0);
  await expect(home(page).locator('.home-compose')).toHaveClass(/compact/);
});

test('Dismiss ends the meeting lead for good', async ({ page }) => {
  await openHomeInMeeting(page, 4);
  await expect(lead(page)).toBeVisible();
  await lead(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(lead(page)).toHaveCount(0);
  await expect(home(page).getByRole('heading', { level: 1 })).not.toContainText('Standup');
  await expect(home(page).locator('.home-compose')).not.toHaveClass(/compact/);
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(lead(page)).toHaveCount(0);
});

test('Snooze 1 min hides the lead until the minute is up', async ({ page }) => {
  await openHomeInMeeting(page, 4);
  await lead(page).getByRole('button', { name: 'Snooze 1 min' }).click();
  await expect(lead(page)).toHaveCount(0);
  await page.clock.fastForward('01:10');
  await expect(lead(page)).toBeVisible();
});

test('a meeting outside its Join time leaves the board as it was', async ({ page }) => {
  await openHomeInMeeting(page, 25);
  await expect(home(page).getByRole('region', { name: 'Your day' })).toContainText('Standup');
  await expect(lead(page)).toHaveCount(0);
  await expect(home(page).locator('.home-lead')).toBeEmpty();
});

test('Before you go previews tomorrow in the day column', async ({ page }) => {
  await seedChats([{ title: 'Overnight refactor', run: { status: 'running' } }]);
  startEventsIn(4);
  await matchApiClock(page);
  const evening = new Date(apiNow());
  evening.setHours(18, 0, 0, 0);
  await setPageClock(page, evening.getTime());
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  await page.goto('/');

  await expect(home(page).getByRole('region', { name: 'Before you go' })).toBeVisible({
    timeout: 20_000,
  });
  const tomorrow = home(page).getByRole('region', { name: 'Tomorrow' });
  await expect(tomorrow.locator('.hrow-m b')).toHaveText(['Demo day']);
  await expect(tomorrow.getByRole('button', { name: /^Join/ })).toHaveCount(0);
  await expect(home(page).getByRole('region', { name: 'Your day' })).toHaveCount(0);
});
