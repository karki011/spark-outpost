import {
  nextRuns,
  runsPerDay,
  scheduleSlotReasonLine,
  workflowScheduleSchema,
  type ScheduleSlot,
  type ScheduleUnit,
  type WorkflowRun,
  type WorkflowRunSource,
  type WorkflowSchedule,
} from '@spark-outpost/contracts';
import { formatClock, type HourCycle } from '../calendar/clock-format.ts';
import { formatElapsed } from '../ui/elapsed.ts';

export const NEXT_RUNS_SHOWN = 3;
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
export const DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UNIT_WORDS: Record<ScheduleUnit, [string, string]> = {
  minutes: ['min', 'min'],
  hours: ['hour', 'hours'],
  days: ['day', 'days'],
  weeks: ['week', 'weeks'],
};

const pad = (value: number) => String(value).padStart(2, '0');

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function windowed(unit: ScheduleUnit): boolean {
  return unit === 'minutes' || unit === 'hours';
}

export function defaultSchedule(today: Date): WorkflowSchedule {
  return workflowScheduleSchema.parse({
    enabled: false,
    every: 1,
    unit: 'days',
    from: '09:00',
    anchor: localDate(today),
    projectId: null,
  });
}

export function editSchedule(
  schedule: WorkflowSchedule,
  patch: Partial<WorkflowSchedule>,
  today: Date,
): WorkflowSchedule {
  const next = { ...schedule, ...patch };
  const retimed = next.every !== schedule.every || next.unit !== schedule.unit;
  return {
    ...next,
    to: windowed(next.unit) ? next.to : null,
    anchor: retimed ? localDate(today) : next.anchor,
  };
}

export function toggleDay(days: readonly number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day];
  return next.length === 7 ? [] : next.toSorted((a, b) => a - b);
}

export function scheduleProblem(schedule: WorkflowSchedule): string | null {
  if (!workflowScheduleSchema.safeParse(schedule).success) {
    return 'Every takes a whole number from 1 to 1000.';
  }
  if (windowed(schedule.unit) && schedule.to !== null && schedule.to <= schedule.from) {
    return 'The end of the hours must be after the start.';
  }
  return null;
}

function clockOf(clock: string, cycle: HourCycle): string {
  const [hours, minutes] = clock.split(':').map(Number);
  return formatClock(new Date(2000, 0, 1, hours ?? 0, minutes ?? 0).getTime(), cycle);
}

function daysLine(days: readonly number[]): string {
  if (days.length === 0) return '';
  const sorted = days.toSorted((a, b) => a - b);
  if (sorted.join() === WEEKDAYS.join()) return 'weekdays';
  if (sorted.join() === '0,6') return 'weekends';
  return DAY_ORDER.filter((day) => sorted.includes(day))
    .map((day) => DAY_NAMES[day]!.slice(0, 3))
    .join(', ');
}

export function scheduleSummary(schedule: WorkflowSchedule, cycle: HourCycle): string {
  const [one, many] = UNIT_WORDS[schedule.unit];
  const every = schedule.every === 1 ? `Every ${one}` : `Every ${schedule.every} ${many}`;
  const days = daysLine(schedule.days);
  if (!windowed(schedule.unit)) {
    return `${every}${days ? ` · ${days}` : ''} at ${clockOf(schedule.from, cycle)}`;
  }
  const whole = schedule.from === '00:00' && schedule.to === null;
  const hours = whole
    ? ''
    : schedule.to === null
      ? `from ${clockOf(schedule.from, cycle)}`
      : `${clockOf(schedule.from, cycle)}–${clockOf(schedule.to, cycle)}`;
  const detail = [days, hours].filter(Boolean).join(' ');
  return detail ? `${every} · ${detail}` : every;
}

function dayLabel(date: Date, now: Date): string {
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const apart = Math.round((start(date) - start(now)) / MS_PER_DAY);
  if (apart === 0) return 'Today';
  if (apart === 1) return 'Tomorrow';
  if (apart === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function whenLine(date: Date, now: Date, cycle: HourCycle): string {
  return `${dayLabel(date, now)} · ${formatClock(date.getTime(), cycle)}`;
}

export function nextRunLines(schedule: WorkflowSchedule, now: Date, cycle: HourCycle): string[] {
  if (scheduleProblem(schedule) !== null) return [];
  return nextRuns(schedule, now, NEXT_RUNS_SHOWN).map((run) => whenLine(run, now, cycle));
}

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function estimateLine(schedule: WorkflowSchedule, lastRunCostUsd: number | null): string {
  if (scheduleProblem(schedule) !== null) return '';
  if (!windowed(schedule.unit)) {
    const [one, many] = UNIT_WORDS[schedule.unit];
    const pace =
      schedule.every === 1 ? `One run a ${one}` : `One run every ${schedule.every} ${many}`;
    const days = schedule.days.length > 0 ? ', on the days picked' : '';
    const cost =
      lastRunCostUsd === null ? '' : ` · about ${usd(lastRunCostUsd)} a run at the last run’s cost`;
    return `${pace}${days}${cost}`;
  }
  const runs = runsPerDay(schedule);
  const pace = `About ${runs} ${runs === 1 ? 'run' : 'runs'} a day`;
  if (lastRunCostUsd === null) return pace;
  return `${pace} · about ${usd(runs * lastRunCostUsd)} a day at the last run’s cost`;
}

export type HistoryTone = 'running' | 'succeeded' | 'failed' | 'quiet';

export interface HistoryRow {
  key: string;
  at: number;
  when: string;
  how: string;
  scheduled: boolean;
  state: string;
  tone: HistoryTone;
  note: string;
  took: string;
  conversationId: string | null;
}

const HOW: Record<WorkflowRunSource, string> = {
  schedule: 'Scheduled',
  catch_up: 'Caught up',
  manual: 'Run now',
  mention: 'In a chat',
};

const RUN_STATE: Record<WorkflowRun['status'], [string, HistoryTone]> = {
  running: ['Running', 'running'],
  succeeded: ['Done', 'succeeded'],
  failed: ['Failed', 'failed'],
  cancelled: ['Stopped', 'quiet'],
  outcome_unknown: ['Unknown', 'quiet'],
};

const SLOT_STATE: Record<ScheduleSlot['state'], string> = {
  claimed: 'Starting',
  started: 'Started',
  skipped: 'Skipped',
  held: 'Held',
  not_started: 'Not started',
};

function runRow(run: WorkflowRun, now: Date, cycle: HourCycle): HistoryRow {
  const started = new Date(run.startedAt);
  const [state, tone] = RUN_STATE[run.status];
  const failed = run.steps.find((step) => step.stepId === run.stoppedBy);
  return {
    key: `run:${run.id}`,
    at: started.getTime(),
    when: whenLine(started, now, cycle),
    how: HOW[run.source],
    scheduled: run.source === 'schedule' || run.source === 'catch_up',
    state,
    tone,
    note: failed ? `${failed.stepId} stopped the workflow` : '',
    took: run.finishedAt ? formatElapsed(Date.parse(run.finishedAt) - started.getTime()) : '',
    conversationId: run.conversationId,
  };
}

function slotRow(slot: ScheduleSlot, now: Date, cycle: HourCycle): HistoryRow {
  const first = new Date(slot.slotAt);
  const last = new Date(slot.lastSlotAt);
  const range = last.getTime() > first.getTime() ? ` to ${formatClock(last.getTime(), cycle)}` : '';
  return {
    key: `slot:${slot.id}`,
    at: last.getTime(),
    when: `${whenLine(first, now, cycle)}${range}`,
    how: slot.source === 'catch_up' ? 'Caught up' : 'Scheduled',
    scheduled: true,
    state: SLOT_STATE[slot.state],
    tone: slot.state === 'not_started' ? 'failed' : 'quiet',
    note: scheduleSlotReasonLine(slot),
    took: '',
    conversationId: null,
  };
}

export function historyRows(
  runs: readonly WorkflowRun[],
  slots: readonly ScheduleSlot[],
  now: Date,
  cycle: HourCycle,
): HistoryRow[] {
  const quiet = slots.filter((slot) => slot.state !== 'started' && slot.state !== 'claimed');
  return [
    ...runs.filter((run) => run.kind === 'run').map((run) => runRow(run, now, cycle)),
    ...quiet.map((slot) => slotRow(slot, now, cycle)),
  ].toSorted((a, b) => b.at - a.at);
}
