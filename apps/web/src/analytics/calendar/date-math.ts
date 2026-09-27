import { ANALYTICS_MAX_DAYS } from '@spark-outpost/contracts';

const DAY_MS = 86_400_000;

export function isoToUtcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addIsoDays(iso: string, days: number): string {
  return new Date(isoToUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isoSpanDays(from: string, to: string): number {
  return Math.round((isoToUtcMs(to) - isoToUtcMs(from)) / DAY_MS) + 1;
}

export function parseIsoLocal(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function formatIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface CalendarPreset {
  id: string;
  label: string;
  range: (today: string) => { from: string; to: string };
}

function firstOfMonth(iso: string): string {
  const [year, month] = iso.split('-') as [string, string];
  return `${year}-${month}-01`;
}

export const CALENDAR_PRESETS: CalendarPreset[] = [
  {
    id: 'last7',
    label: 'Last 7 days',
    range: (today) => ({ from: addIsoDays(today, -6), to: today }),
  },
  {
    id: 'last30',
    label: 'Last 30 days',
    range: (today) => ({ from: addIsoDays(today, -29), to: today }),
  },
  {
    id: 'last90',
    label: 'Last 90 days',
    range: (today) => ({ from: addIsoDays(today, -89), to: today }),
  },
  {
    id: 'thisMonth',
    label: 'This month',
    range: (today) => ({ from: firstOfMonth(today), to: today }),
  },
  {
    id: 'lastMonth',
    label: 'Last month',
    range: (today) => {
      const lastDayPrevMonth = addIsoDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(lastDayPrevMonth), to: lastDayPrevMonth };
    },
  },
];

export function isFutureIso(iso: string, todayIso: string): boolean {
  return iso > todayIso;
}

export function isCappedOut(
  anchor: string | undefined,
  candidateIso: string,
  maxDays = ANALYTICS_MAX_DAYS,
): boolean {
  if (!anchor) return false;
  const span =
    candidateIso >= anchor ? isoSpanDays(anchor, candidateIso) : isoSpanDays(candidateIso, anchor);
  return span > maxDays;
}

export function formatRangeLabel(from: string, to: string): string {
  const fromDate = parseIsoLocal(from);
  const toDate = parseIsoLocal(to);
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const fromFmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
  const toFmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${fromFmt.format(fromDate)} – ${toFmt.format(toDate)}`;
}
