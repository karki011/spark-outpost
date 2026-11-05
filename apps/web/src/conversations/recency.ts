export interface RecencyBucket<T> {
  label: string;
  items: T[];
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

function daysBefore(now: number, days: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - days);
  return day.getTime();
}

export function recencyLabel(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time) || time >= daysBefore(now, 0)) return 'Today';
  if (time >= daysBefore(now, 1)) return 'Yesterday';
  if (time >= daysBefore(now, 7)) return 'Previous 7 days';
  if (time >= daysBefore(now, 30)) return 'Previous 30 days';
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? MONTH : MONTH_YEAR).format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function activeLabel(iso: string, now: number = Date.now()): string {
  const label = recencyLabel(iso, now);
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  if (label === 'Today') {
    if (Number.isNaN(elapsed) || elapsed < MINUTE) return 'Just now';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }
  if (label === 'Previous 7 days' || label === 'Previous 30 days') {
    const days = Math.round(
      (daysBefore(now, 0) - daysBefore(new Date(iso).getTime(), 0)) / (24 * HOUR),
    );
    return `${days}d ago`;
  }
  return label;
}

export function recencyBuckets<T>(
  items: readonly T[],
  timeOf: (item: T) => string,
  now: number = Date.now(),
): RecencyBucket<T>[] {
  const newestFirst = items.toSorted((a, b) => timeOf(b).localeCompare(timeOf(a)));
  const buckets: RecencyBucket<T>[] = [];
  for (const item of newestFirst) {
    const label = recencyLabel(timeOf(item), now);
    const last = buckets.at(-1);
    if (last?.label === label) last.items.push(item);
    else buckets.push({ label, items: [item] });
  }
  return buckets;
}
