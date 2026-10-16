import type { DayShape } from '@spark-outpost/contracts';

const MINUTE_MS = 60_000;

export function clock(at: number): string {
  const time = new Date(at);
  return `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`;
}

export function span(start: number, end: number): string {
  return `${clock(start)}–${clock(end)}`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}

export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / MINUTE_MS));
}

export function shapeWords(shape: DayShape): string {
  return [
    `${shape.load} day`,
    `meetings ${duration(shape.meetingMinutes)}`,
    `focus ${duration(shape.focusMinutes)}`,
    `free ${duration(shape.freeMinutes)}`,
  ].join(' · ');
}

export function dateOf(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dayTitle(iso: string): string {
  return dateOf(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function weekdayShort(iso: string): string {
  const date = dateOf(iso);
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.getDate()}`;
}
