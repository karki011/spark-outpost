import type { Page } from '@playwright/test';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

export function apiNow(): number {
  return Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
}

function apiClockInstalled(): boolean {
  return readCalendarClock(FAKE_CALENDAR_STATE) !== 0;
}

export async function matchApiClock(page: Page): Promise<void> {
  if (apiClockInstalled()) await page.clock.install({ time: apiNow() });
}

export async function setPageClock(page: Page, time: number): Promise<void> {
  if (apiClockInstalled()) await page.clock.setSystemTime(time);
  else await page.clock.install({ time });
}
