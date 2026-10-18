import type { Page } from '@playwright/test';
import { readCalendarClock } from './fake-calendar-clock.ts';
import { FAKE_CALENDAR_STATE } from './stub-config.ts';

export function apiNow(): number {
  return Date.now() + readCalendarClock(FAKE_CALENDAR_STATE);
}

export async function matchApiClock(page: Page): Promise<void> {
  if (readCalendarClock(FAKE_CALENDAR_STATE) !== 0) await page.clock.install({ time: apiNow() });
}
