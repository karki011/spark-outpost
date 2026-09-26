const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth())}-${pad(date.getUTCDate())}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
