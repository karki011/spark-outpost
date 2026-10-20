export type HourCycle = 'h12' | 'h23';

interface ClockTime {
  hour: number;
  minute: string;
  period: 'AM' | 'PM';
}

function timeOf(at: number): ClockTime {
  const date = new Date(at);
  const hour = date.getHours();
  return {
    hour,
    minute: String(date.getMinutes()).padStart(2, '0'),
    period: hour < 12 ? 'AM' : 'PM',
  };
}

function twelve(hour: number): number {
  return hour % 12 === 0 ? 12 : hour % 12;
}

function bare(time: ClockTime, cycle: HourCycle): string {
  return cycle === 'h12' ? `${twelve(time.hour)}:${time.minute}` : `${time.hour}:${time.minute}`;
}

export function formatClock(at: number, cycle: HourCycle): string {
  const time = timeOf(at);
  return cycle === 'h12' ? `${bare(time, cycle)} ${time.period}` : bare(time, cycle);
}

export function formatSpan(start: number, end: number, cycle: HourCycle): string {
  if (cycle === 'h23') return `${formatClock(start, cycle)}–${formatClock(end, cycle)}`;
  const from = timeOf(start);
  const to = timeOf(end);
  if (from.period === to.period) return `${bare(from, cycle)}–${formatClock(end, cycle)}`;
  return `${formatClock(start, cycle)}–${formatClock(end, cycle)}`;
}

export function formatHour(at: number, cycle: HourCycle): string {
  const time = timeOf(at);
  return cycle === 'h12' ? `${twelve(time.hour)} ${time.period}` : `${time.hour}:00`;
}

export function localeHourCycle(locale?: string): HourCycle {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12' ? 'h12' : 'h23';
}
