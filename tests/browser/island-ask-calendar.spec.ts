import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SWITCH_STEP =
  'turn on Let agents read my calendar on the Calendar card in Settings → Connectors → Calendar';
const fakeNow = () => Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const log = (page: Page) => island(page).locator('.isl-ask-log');

function tomorrow(): string {
  const day = new Date(fakeNow() + DAY);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const readTomorrow = () =>
  `#build #spark spark_calendar {"action":"events","from":"${tomorrow()}"}`;

async function askActs() {
  const db = openTestDb();
  try {
    await db.query(`UPDATE profiles SET assistant_acts = 'act'`);
  } finally {
    await db.end();
  }
}

async function openAsk(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  return ask;
}

async function setAgentsRead(page: Page, on: boolean) {
  const saved = await page.request.patch('/api/calendar/settings', { data: { agentsRead: on } });
  expect(saved.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  const anchor = Math.floor(fakeNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ authorization: 'fullAccess', anchor }));
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  const connected = await page.request.post('/api/calendar/connect', { data: {} });
  expect(connected.ok()).toBe(true);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('in Manual, Ask Spark asks on a card in the island, then reads tomorrow', async ({ page }) => {
  test.setTimeout(60_000);
  const ask = await openAsk(page);
  await ask.fill(`What do I have in calendar tomorrow? ${readTomorrow()}`);
  await page.keyboard.press('Enter');
  const card = log(page).getByRole('group', { name: /read your calendar/ });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(log(page)).not.toContainText('Demo day');
  await card.getByRole('button', { name: 'Allow for this chat' }).click();
  await expect(log(page)).toContainText('Demo day', { timeout: 20_000 });
});

test('Ask Spark reads tomorrow’s calendar with the switch on, its default', async ({ page }) => {
  test.setTimeout(60_000);
  await askActs();
  const ask = await openAsk(page);
  await ask.fill(`What do I have in calendar tomorrow? ${readTomorrow()}`);
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Demo day', { timeout: 20_000 });
});

test('with the switch off, Ask Spark is told the exact setting and where it is', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await askActs();
  await setAgentsRead(page, false);
  const ask = await openAsk(page);
  await ask.fill('What do I have in calendar tomorrow? #build #sparkinstructions');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText(SWITCH_STEP, { timeout: 20_000 });
  await expect(log(page)).not.toContainText('Demo day');

  await setAgentsRead(page, true);
  await ask.fill(`And now? ${readTomorrow()}`);
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Demo day', { timeout: 20_000 });
});
