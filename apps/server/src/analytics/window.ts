import {
  ANALYTICS_MAX_DAYS,
  RANGE_DAYS,
  type AnalyticsQuery,
  type AnalyticsWindow,
} from '@spark-outpost/contracts';

const DAY_MS = 86_400_000;

export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function resolveWindow(
  query: AnalyticsQuery,
  timeZone: string,
  now = new Date(),
): AnalyticsWindow | null {
  if (query.range === 'custom') {
    const from = query.from!;
    const to = query.to!;
    const days = daysBetween(from, to);
    if (days < 1 || days > ANALYTICS_MAX_DAYS) return null;
    return { range: 'custom', from, to, days, timeZone };
  }
  const days = RANGE_DAYS[query.range];
  const to = localDate(now, timeZone);
  return { range: query.range, from: addDays(to, 1 - days), to, days, timeZone };
}

export function windowDates(window: Pick<AnalyticsWindow, 'from' | 'days'>): string[] {
  return Array.from({ length: window.days }, (_, index) => addDays(window.from, index));
}
