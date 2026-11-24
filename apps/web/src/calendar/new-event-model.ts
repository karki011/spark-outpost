import {
  CALENDAR_GUESTS_MAX,
  type CalendarChoice,
  type CalendarStatus,
  type CalendarVideo,
} from '@spark-outpost/contracts';
import { dateOf } from './calendar-format.ts';

const HALF_HOUR_MS = 30 * 60_000;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EventTimes {
  date: string;
  start: string;
  end: string;
}

function clockOf(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export function defaultTimes(date: string, today: string, now: number): EventTimes {
  if (date !== today) return { date, start: '09:00', end: '09:30' };
  const start = new Date(Math.ceil(now / HALF_HOUR_MS) * HALF_HOUR_MS);
  const end = new Date(start.getTime() + HALF_HOUR_MS);
  const sameDay = start.getDate() === new Date(now).getDate() && end.getDate() === start.getDate();
  return sameDay
    ? { date, start: clockOf(start), end: clockOf(end) }
    : { date, start: '09:00', end: '09:30' };
}

function at(date: string, time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const day = dateOf(date);
  day.setHours(hours, minutes, 0, 0);
  return day.getTime();
}

export function eventSpan(times: EventTimes): { start: string; end: string } | null {
  const start = at(times.date, times.start);
  const end = at(times.date, times.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export interface Guests {
  emails: string[];
  problem: string | null;
}

export function parseGuests(text: string): Guests {
  const emails = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((email) => email.toLowerCase()),
    ),
  ];
  const bad = emails.find((email) => !ADDRESS.test(email));
  if (bad) return { emails, problem: `“${bad}” is not an email address.` };
  if (emails.length > CALENDAR_GUESTS_MAX) {
    return { emails, problem: `At most ${CALENDAR_GUESTS_MAX} guests.` };
  }
  return { emails, problem: null };
}

export interface EventCalendar {
  key: string;
  title: string;
  accountId: string;
  email: string;
  canEdit: boolean;
}

function accountIdOf(choice: CalendarChoice): string | null {
  return /^google:([^:]+):/.exec(choice.calendarId)?.[1] ?? null;
}

export function eventCalendars(status: CalendarStatus): EventCalendar[] {
  const accounts = new Map(status.google.accounts.map((account) => [account.id, account]));
  return status.accounts
    .flatMap((account) => account.calendars)
    .flatMap((choice) => {
      const account = accounts.get(accountIdOf(choice) ?? '');
      if (!account || !choice.writable || !choice.key || choice.sourceKind !== 'google') return [];
      return [
        {
          key: choice.key,
          title: choice.title,
          accountId: account.id,
          email: account.email,
          canEdit: account.canEdit,
        },
      ];
    });
}

export function videoChoices(zoomReady: boolean): { id: CalendarVideo; label: string }[] {
  return [
    { id: 'none', label: 'None' },
    { id: 'meet', label: 'Google Meet' },
    ...(zoomReady ? [{ id: 'zoom' as const, label: 'Zoom' }] : []),
  ];
}
