const pad = (value: number) => String(value).padStart(2, '0');

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export function weekStart(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (isoWeekday(now) - 1));
  return start;
}

function minutesOf(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function recapDue(now: Date, day: number, time: string): boolean {
  const today = isoWeekday(now);
  if (today !== day) return today > day;
  return now.getHours() * 60 + now.getMinutes() >= minutesOf(time);
}
