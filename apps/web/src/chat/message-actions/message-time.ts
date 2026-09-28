const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function messageTime(iso: string, now: number): string {
  const then = new Date(iso);
  const elapsed = Math.max(0, now - then.getTime());
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return relative.format(-Math.floor(elapsed / DAY), 'day');
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}
