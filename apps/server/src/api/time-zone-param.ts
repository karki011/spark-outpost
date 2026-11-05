import { BadRequestError } from './validation.ts';

const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

export function timeZoneParam(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'UTC';
  if (value.length > 64 || !TIME_ZONE.test(value)) throw new BadRequestError('Unknown time zone.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new BadRequestError('Unknown time zone.');
  }
  return value;
}
