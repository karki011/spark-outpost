import type { Page } from '@playwright/test';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

export function apiNow(): number {
  return Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
}

const installed = new WeakSet<Page>();

export async function matchApiClock(page: Page): Promise<void> {
  await page.clock.install({ time: apiNow() });
  installed.add(page);
}

export async function setPageClock(page: Page, time: number): Promise<void> {
  if (installed.has(page)) await page.clock.setSystemTime(time);
  else await page.clock.install({ time });
}
