import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  calendarNowSchema,
  type MeetingAlertPayload,
} from '../../packages/contracts/src/index.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { island, openNotchIsland } from './island-notch-desktop.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
test.describe.configure({ mode: 'serial' });

const MINUTE = 60_000;

interface AlertWindow {
  alertShows: MeetingAlertPayload[];
  alertHides: number;
  alertActs: unknown[];
  alertRegions: { boxes: unknown[] }[];
  alertFocus: number;
  alertAction: (action: unknown) => void;
  alertFeed: { payload: (value: unknown) => void; leave: () => void };
}

async function recordIslandAlerts(page: Page) {
  await page.addInitScript(() => {
    const shows: unknown[] = [];
    const record = { alertShows: shows, alertHides: 0 };
    Object.assign(window, record);
    const desktop = (window as unknown as { sparkDesktop: Record<string, unknown> }).sparkDesktop;
    desktop.meetingAlert = {
      show: (payload: unknown) => shows.push(payload),
      hide: () => Object.assign(window, { alertHides: (window as never as AlertWindow).alertHides + 1 }),
      onAction: (callback: (action: unknown) => void) => {
        Object.assign(window, { alertAction: callback });
        return () => undefined;
      },
      presence: async () => ({ idleSeconds: 0, locked: false, asleep: false }),
      autoJoined: () => undefined,
    };
  });
}

async function openOverlay(page: Page, payload: MeetingAlertPayload) {
  await page.addInitScript((payload) => {
    const acts: unknown[] = [];
    const regions: unknown[] = [];
    let onPayload: (value: unknown) => void = () => undefined;
    let onPlace: (value: unknown) => void = () => undefined;
    let onLeave: () => void = () => undefined;
    Object.assign(window, { alertActs: acts, alertRegions: regions, alertFocus: 0 });
    Object.assign(window, {
      alertFeed: { payload: (value: unknown) => onPayload(value), leave: () => onLeave() },
      sparkDesktop: {
        platform: 'darwin',
        meetingAlert: {
          onPayload: (callback: (value: unknown) => void) => {
            onPayload = callback;
            return () => undefined;
          },
          onPlace: (callback: (value: unknown) => void) => {
            onPlace = callback;
            return () => undefined;
          },
          onLeave: (callback: () => void) => {
            onLeave = callback;
            return () => undefined;
          },
          ready: () => {
            onPlace({ anchorX: 640, top: 38, width: 1280, height: 720 });
            onPayload(payload);
          },
          act: (action: unknown) => acts.push(action),
          gone: () => undefined,
          focus: () =>
            Object.assign(window, { alertFocus: (window as never as AlertWindow).alertFocus + 1 }),
          setRegions: (next: unknown) => regions.push(next),
          pointerMoved: () => undefined,
        },
      },
    });
  }, payload);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/meeting-alert');
}

const alertWindow = <T,>(page: Page, read: (window: AlertWindow) => T): Promise<T> =>
  page.evaluate(`(${read.toString()})(window)`);

async function standupPayload(page: Page): Promise<MeetingAlertPayload> {
  const response = await page.request.get('/api/calendar/now');
  const upcoming = calendarNowSchema.parse(await response.json()).upcoming;
  const standup = upcoming.find((event) => event.title === 'Standup')!;
  return {
    key: standup.key,
    events: [standup],
    calendars: { [standup.calendarKey]: 'Spark Work' },
    countdown: null,
  };
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

test('the centre alert takes over from the island bubble and Dismiss sends it back up', async ({
  page,
}) => {
  const settings = await page.request.patch('/api/calendar/settings', {
    data: { alertLead: 5 },
  });
  expect(settings.ok()).toBe(true);
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await recordIslandAlerts(page);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as AlertWindow).alertShows.length))
    .toBeGreaterThan(0);
  const shown = await page.evaluate(() => (window as unknown as AlertWindow).alertShows.at(-1)!);
  expect(shown.events.map((event) => event.title)).toEqual(['Standup']);
  expect(Object.values(shown.calendars)).toEqual(['Spark Work']);
  await expect(island(page).getByRole('group', { name: 'Meeting Standup' })).toHaveCount(0);

  await page.evaluate(
    (key) => (window as unknown as AlertWindow).alertAction({ kind: 'dismiss', key, eventKey: null }),
    shown.key,
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as AlertWindow).alertHides))
    .toBeGreaterThan(0);
});

test('Bubble from Scout keeps the island bubble and sends no centre alert', async ({ page }) => {
  const settings = await page.request.patch('/api/calendar/settings', {
    data: { alertStyle: 'bubble', alertLead: 5 },
  });
  expect(settings.ok()).toBe(true);
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await recordIslandAlerts(page);
  await page.reload();
  await expect(island(page).getByRole('group', { name: 'Meeting Standup' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as AlertWindow).alertShows)).toEqual([]);
});

test('the hanging card offers Join, Snooze and Dismiss, and Esc dismisses once clicked', async ({
  page,
}) => {
  const payload = await standupPayload(page);
  await openOverlay(page, payload);
  const card = page.getByRole('alertdialog', { name: /^Standup starts in \d min$/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d+:\d{2}( [AP]M)?–\d+:\d{2} [AP]M · Zoom · 3 people/);
  await expect(card.getByRole('button', { name: 'Join Zoom' })).toBeVisible();
  await expect(card).toHaveAccessibleDescription('Esc dismisses · ⌘J joins');
  await expect
    .poll(() => alertWindow(page, (window) => window.alertRegions.at(-1)?.boxes.length ?? 0))
    .toBe(2);

  await card.getByRole('button', { name: 'Snooze 1 min' }).click({ force: true });
  expect(await alertWindow(page, (window) => window.alertFocus)).toBe(0);
  await card.getByText('Esc dismisses').click({ force: true });
  expect(await alertWindow(page, (window) => window.alertFocus)).toBe(1);
  await page.keyboard.press('Escape');
  expect(await alertWindow(page, (window) => window.alertActs)).toEqual([
    { kind: 'snooze', key: payload.key, eventKey: null },
    { kind: 'dismiss', key: payload.key, eventKey: null },
  ]);

  await page.evaluate(() => (window as unknown as AlertWindow).alertFeed.leave());
  await expect(card).toBeHidden();
});

test('meetings that start together share one card with a Join for each', async ({ page }) => {
  const single = await standupPayload(page);
  const [standup] = single.events;
  const design = {
    ...standup!,
    key: `design@${standup!.start}`,
    eventId: 'design',
    title: 'Design sync',
    link: { ...standup!.link!, service: 'meet' as const, url: 'https://meet.google.com/abc' },
  };
  await openOverlay(page, { ...single, key: `${design.key}|${standup!.key}`, events: [design, standup!] });
  const card = page.getByRole('alertdialog', { name: /^2 meetings start in \d min$/ });
  await expect(card.getByRole('listitem')).toHaveCount(2);
  await expect(card.getByRole('button', { name: 'Join Google Meet' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Join Zoom' })).toBeVisible();
});

test('with reduced motion the card fades in without the drop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOverlay(page, await standupPayload(page));
  await expect(page.getByRole('alertdialog')).toBeVisible();
  const animations = await page.evaluate(() =>
    [...document.querySelectorAll('.ma-rig, .ma-thread, .ma-hang, .ma-card')].map(
      (node) => getComputedStyle(node).animationName,
    ),
  );
  expect(animations).toEqual(['none', 'none', 'none', 'none']);
});
