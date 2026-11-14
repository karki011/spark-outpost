import { z } from 'zod';

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEARCH_DAYS_MAX = 366 * 2;

export const SCHEDULE_MESSAGE_MAX = 4000;
export const SCHEDULE_EVERY_MAX = 1000;

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const scheduleUnitSchema = z.enum(['minutes', 'hours', 'days', 'weeks']);
export type ScheduleUnit = z.infer<typeof scheduleUnitSchema>;

export const scheduleMissedSchema = z.enum(['run_once', 'skip']);
export type ScheduleMissed = z.infer<typeof scheduleMissedSchema>;

export const workflowScheduleSchema = z.object({
  enabled: z.boolean(),
  every: z.number().int().min(1).max(SCHEDULE_EVERY_MAX),
  unit: scheduleUnitSchema,
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  from: clockSchema.default('00:00'),
  to: clockSchema.nullable().default(null),
  anchor: dateSchema,
  projectId: z.uuid().nullable(),
  message: z.string().max(SCHEDULE_MESSAGE_MAX).default(''),
  missed: scheduleMissedSchema.default('run_once'),
});
export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;

export type ScheduleTiming = Pick<
  WorkflowSchedule,
  'every' | 'unit' | 'days' | 'from' | 'to' | 'anchor'
>;
export type NextRuns = (schedule: ScheduleTiming, after: Date, count: number) => Date[];
export type RunsPerDay = (schedule: ScheduleTiming) => number;
export type MissedRun = (schedule: ScheduleTiming, lastChecked: Date, now: Date) => Date | null;

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month, day) / MS_PER_DAY);
}

function anchorDay(anchor: string): number {
  const [year, month, day] = anchor.split('-').map(Number);
  return dayNumber(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function slotMinutes(schedule: ScheduleTiming): number[] {
  const first = minutesOf(schedule.from);
  if (schedule.unit === 'days' || schedule.unit === 'weeks') return [first];
  const step = schedule.unit === 'hours' ? schedule.every * 60 : schedule.every;
  const last = schedule.to === null ? MINUTES_PER_DAY - 1 : minutesOf(schedule.to);
  const slots: number[] = [];
  for (let minute = first; minute <= last; minute += step) slots.push(minute);
  return slots;
}

function runsOn(schedule: ScheduleTiming, date: Date): boolean {
  if (schedule.days.length > 0 && !schedule.days.includes(date.getDay())) return false;
  const elapsed =
    dayNumber(date.getFullYear(), date.getMonth(), date.getDate()) - anchorDay(schedule.anchor);
  if (schedule.unit === 'days') return elapsed >= 0 && elapsed % schedule.every === 0;
  if (schedule.unit === 'weeks') {
    const anchorWeekday = new Date(`${schedule.anchor}T12:00:00`).getDay();
    const weeks = Math.floor((elapsed + anchorWeekday) / 7);
    return elapsed >= 0 && weeks % schedule.every === 0;
  }
  return true;
}

export const nextRuns: NextRuns = (schedule, after, count) => {
  const slots = slotMinutes(schedule);
  const runs: Date[] = [];
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate());
  for (let offset = 0; offset < SEARCH_DAYS_MAX && runs.length < count; offset += 1) {
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
    if (!runsOn(schedule, date)) continue;
    for (const minute of slots) {
      const run = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minute);
      if (run.getTime() > after.getTime() && runs.length < count) runs.push(run);
    }
  }
  return runs;
};

export const runsPerDay: RunsPerDay = (schedule) => slotMinutes(schedule).length;

export const missedRun: MissedRun = (schedule, lastChecked, now) => {
  const [next] = nextRuns(schedule, lastChecked, 1);
  return next !== undefined && next.getTime() <= now.getTime() ? next : null;
};
