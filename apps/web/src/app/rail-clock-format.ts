import type { HourCycle } from '../calendar/clock-format.ts';

type ClockPartKind = 'hour' | 'minute' | 'period' | 'literal';

export interface ClockPart {
  kind: ClockPartKind;
  text: string;
}

const PART_KINDS: Partial<Record<Intl.DateTimeFormatPartTypes, ClockPartKind>> = {
  hour: 'hour',
  minute: 'minute',
  dayPeriod: 'period',
};

const WIDE_SPACES = /[\u202f\u00a0]/g;

export function clockParts(date: Date, locale?: string, hourCycle?: HourCycle): ClockPart[] {
  const format = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle });
  return format.formatToParts(date).map((part) => ({
    kind: PART_KINDS[part.type] ?? 'literal',
    text: part.value,
  }));
}

export function clockLabel(date: Date, locale?: string, hourCycle?: HourCycle): string {
  const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hourCycle });
  return format.format(date).replace(WIDE_SPACES, ' ');
}

export function clockTitle(date: Date, locale?: string, hourCycle?: HourCycle): string {
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    hourCycle,
  });
  return format.format(date).replace(WIDE_SPACES, ' ');
}
