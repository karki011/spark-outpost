import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { calendarNowSchema, calendarStatusSchema } from '../../packages/contracts/src/index.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, fakeState, island, openHome, openIsland } from './island-home-desktop.ts';
import { openNotchIsland, settled } from './island-notch-desktop.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

function startEventsIn(minutes: number) {
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE + (minutes - 4) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor }));
}

async function connect(page: Page) {
  const response = await page.request.post('/api/calendar/connect', { data: {} });
  expect(response.ok()).toBe(true);
  const status = calendarStatusSchema.parse(
    await (await page.request.get('/api/calendar/status')).json(),
  );
  return status.accounts.flatMap((account) => account.calendars);
}

async function upcoming(page: Page) {
  const response = await page.request.get('/api/calendar/now');
  return calendarNowSchema.parse(await response.json()).upcoming;
}

const meetings = (page: Page) => island(page).getByRole('region', { name: 'Next meeting' });
const scout = (page: Page) => island(page).locator('.isl-scout-wrap svg.scout');

async function soundOn(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('fake-island-sound', 'on'));
}

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  startEventsIn(4);
  await matchApiClock(page);
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('every calendar nudges by default, with no busy switch', async ({ page }) => {
  const calendars = await connect(page);
  expect(calendars.map((calendar) => [calendar.include, calendar.nudges])).toEqual([
    [true, true],
    [true, true],
  ]);
  expect(calendars.every((calendar) => !('busy' in calendar))).toBe(true);
});

test('the island hops once with a short tune for a meeting nudge', async ({ page }) => {
  await connect(page);
  await soundOn(page);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await expect(scout(page)).toHaveClass(/\bhappy\b/);
  await expect(scout(page)).not.toHaveClass(/\bhappy\b/, { timeout: 5_000 });
  expect((await fakeState(page)).chimes).toBeGreaterThan(0);
});

test('with reduced motion the island glows instead of hopping', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await connect(page);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await expect(island(page).locator('.isl-glow')).toHaveAttribute('data-mood', 'happy');
  const frames = await scout(page)
    .locator('.sc-hop')
    .evaluate((element) =>
      element
        .getAnimations()
        .map((animation) => (animation.effect as KeyframeEffect).getKeyframes()),
    );
  expect(frames.flat()).toEqual([]);
  expect((await fakeState(page)).chimes).toBe(0);
});

test('the inbox shows the next meeting with Join while it opens, and opens Today on it', async ({
  page,
}) => {
  await connect(page);
  const next = await upcoming(page);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const row = meetings(page);
  await expect(row).toContainText('Standup');
  await expect(row).toContainText(/in [1-5] min/);
  await expect(row.getByRole('button', { name: 'Join Zoom: Standup' })).toBeVisible();
  await row.getByRole('button', { name: /^Standup/ }).click();
  const standup = next.find((event) => event.title === 'Standup')!;
  await expect.poll(async () => (await fakeState(page)).settings).toEqual([`today:${standup.key}`]);
});

test('Join waits until ten minutes before and shows the start time until then', async ({
  page,
}) => {
  startEventsIn(13);
  await connect(page);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(meetings(page)).toContainText('Standup');
  await expect(meetings(page).getByRole('button', { name: /^Join/ })).toHaveCount(0);
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Upcoming' });
  const join = card.getByRole('button', { name: /^Standup at \d+:\d+ [AP]M, Join opens at / });
  await expect(join).toBeDisabled();
  await expect(join).toHaveText(/^\d+:\d+ [AP]M$/);
});

for (const size of ['small', 'large'] as const) {
  test(`the next meeting fits the ${size} island`, async ({ page }) => {
    await connect(page);
    await openNotchIsland(page, { size, autoExpand: false });
    await openHome(page);
    const row = meetings(page);
    await expect(row).toContainText('Standup');
    await settled(page);
    const view = island(page).locator('.isl-view');
    const [shell, box] = await Promise.all([view.boundingBox(), row.boundingBox()]);
    expect(box!.x).toBeGreaterThanOrEqual(shell!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(shell!.x + shell!.width + 1);
    expect(box!.height).toBeLessThanOrEqual(48);
  });
}
