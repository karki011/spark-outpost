import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { MeetingAlertPayload } from '../../packages/contracts/src/index.ts';
import { apiNow, matchApiClock } from './api-clock.ts';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, fakeState, island, openHome } from './island-home-desktop.ts';
import { seedApproval, seedChats } from './sidebar-seed.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

const MINUTE = 60_000;

interface LockedWindow {
  setLocked(locked: boolean): void;
  attentionReports: { count: number }[];
  alertShows: MeetingAlertPayload[];
}

async function openLockableIsland(page: Page, locked: boolean) {
  await fakeHomeDesktop(page, 'light', false);
  await page.addInitScript((locked) => {
    const desktop = (window as unknown as { sparkDesktop: Record<string, unknown> }).sparkDesktop;
    const listeners = new Set<(status: unknown) => void>();
    const reports: unknown[] = [];
    const shows: unknown[] = [];
    const status = {
      enabled: true,
      locked,
      hasCode: true,
      idleMinutes: 5,
      onSleep: true,
      touchId: false,
      touchIdAvailable: false,
      hideNotifications: true,
      retryAt: null,
      recoveryAvailable: false,
    };
    Object.assign(window, {
      attentionReports: reports,
      alertShows: shows,
      setLocked: (next: boolean) => {
        status.locked = next;
        listeners.forEach((listener) => listener({ ...status }));
      },
    });
    desktop.lock = {
      status: async () => ({ ...status }),
      onChange: (listener: (status: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      lockNow: async () => undefined,
    };
    desktop.attention = { report: (report: unknown) => reports.push(report) };
    desktop.meetingAlert = {
      show: (payload: unknown) => shows.push(payload),
      hide: () => undefined,
      onAction: () => () => undefined,
      presence: async () => ({ idleSeconds: 0, locked: false, asleep: false }),
      autoJoined: () => undefined,
    };
  }, locked);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
}

const setLocked = (page: Page, locked: boolean) =>
  page.evaluate((next) => (window as unknown as LockedWindow).setLocked(next), locked);

const reportedCount = (page: Page) =>
  page.evaluate(() => (window as unknown as LockedWindow).attentionReports.at(-1)?.count ?? null);

const shownMeetings = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as LockedWindow).alertShows.map((payload) =>
      payload.events.map((event) => event.title),
    ),
  );

async function expectConcealed(page: Page) {
  await expect(island(page)).toHaveCount(0);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('#root .isl')).toBeHidden();
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test.afterAll(() => {
  rmSync(FAKE_CALENDAR_STATE, { force: true });
});

test('a locked island still reports what needs you, out of sight and out of reach', async ({
  page,
}) => {
  const [chatId] = await seedChats([
    { title: 'Deploy the site', run: { status: 'running' }, minutesAgo: 1 },
  ]);
  await openLockableIsland(page, true);
  await expect.poll(() => reportedCount(page), { timeout: 10_000 }).toBe(0);
  await expectConcealed(page);

  await seedApproval(chatId!, { kind: 'execute', title: 'pnpm test', command: 'pnpm test' });
  await expect.poll(() => reportedCount(page), { timeout: 10_000 }).toBe(1);
  await expectConcealed(page);

  await setLocked(page, false);
  await expect(island(page)).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await openHome(page);

  await setLocked(page, true);
  await expectConcealed(page);
  await page.keyboard.press('ControlOrMeta+o');
  expect((await fakeState(page)).openedChats).toEqual([]);

  await setLocked(page, false);
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+o');
  await expect.poll(async () => (await fakeState(page)).openedChats.length).toBe(1);
});

test('a meeting that reaches its reminder while locked still goes to the Mac', async ({ page }) => {
  test.skip(process.env.SPARK_FAKE_CALENDAR !== '1', 'needs SPARK_FAKE_CALENDAR=1');
  const anchor = Math.floor(apiNow() / MINUTE) * MINUTE;
  writeFileSync(FAKE_CALENDAR_STATE, JSON.stringify({ anchor }));
  await matchApiClock(page);
  const connected = await page.request.post('/api/calendar/connect', { data: {} });
  expect(connected.ok()).toBe(true);
  const settings = await page.request.patch('/api/calendar/settings', { data: { alertLead: 1 } });
  expect(settings.ok()).toBe(true);

  await openLockableIsland(page, false);
  await expect(island(page)).toBeVisible();
  await setLocked(page, true);
  await expectConcealed(page);
  expect(await shownMeetings(page)).toEqual([]);

  await page.clock.fastForward(4 * MINUTE);
  await expect.poll(() => shownMeetings(page), { timeout: 10_000 }).toContainEqual(['Standup']);
  await expectConcealed(page);

  await setLocked(page, false);
  await expect(island(page)).toBeVisible();
});
