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
