const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const sameYearDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const otherYearDate = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

export function messageTime(iso: string, now: number): string {
  const then = new Date(iso);
  const elapsed = Math.max(0, now - then.getTime());
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return relative.format(-Math.floor(elapsed / DAY), 'day');
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? sameYearDate : otherYearDate).format(then);
}

export function fullTime(iso: string): string {
  return full.format(new Date(iso));
}
