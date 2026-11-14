import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';
import {
  missedRun,
  nextRuns,
  workflowScheduleSchema,
  type ScheduleMissed,
  type ScheduleTiming,
} from './crew-schedule.ts';

export const SCHEDULE_LATE_MS = 5 * 60_000;
const ON_TIME_SCAN = 8;

export const scheduleSlotStateSchema = z.enum([
  'claimed',
  'started',
  'skipped',
  'held',
  'not_started',
]);
export type ScheduleSlotState = z.infer<typeof scheduleSlotStateSchema>;

export const scheduleSlotReasonSchema = z.enum([
  'previous_running',
  'missed',
  'paused',
  'problem',
  'project_gone',
  'error',
]);
export type ScheduleSlotReason = z.infer<typeof scheduleSlotReasonSchema>;

export const scheduleSlotSourceSchema = z.enum(['schedule', 'catch_up']);
export type ScheduleSlotSource = z.infer<typeof scheduleSlotSourceSchema>;

export const scheduleSlotSchema = z.object({
  id: z.uuid(),
  slotAt: z.string(),
  lastSlotAt: z.string(),
  state: scheduleSlotStateSchema,
  reason: scheduleSlotReasonSchema.nullable(),
  detail: z.string().nullable(),
  source: scheduleSlotSourceSchema,
  workflowRunId: z.uuid().nullable(),
  releasedAt: z.string().nullable(),
});
export type ScheduleSlot = z.infer<typeof scheduleSlotSchema>;

export const scheduleSlotsSchema = z.object({ slots: z.array(scheduleSlotSchema) });
export type ScheduleSlots = z.infer<typeof scheduleSlotsSchema>;

export const workflowScheduleViewSchema = z.object({
  schedule: workflowScheduleSchema.nullable(),
  conversationId: z.uuid().nullable(),
  lastRunCostUsd: z.number().nullable(),
});
export type WorkflowScheduleView = z.infer<typeof workflowScheduleViewSchema>;

export const workflowSchedulesSchema = z.object({
  schedules: z.array(z.object({ workflowId: crewSlugSchema, schedule: workflowScheduleSchema })),
});
export type WorkflowSchedules = z.infer<typeof workflowSchedulesSchema>;

export const scheduleUpdateSchema = z.object({
  workflowId: crewSlugSchema,
  name: z.string(),
  runsToday: z.number().int().min(0),
  failedToday: z.number().int().min(0),
});
export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;

export function scheduleUpdateLine(update: ScheduleUpdate): string {
  const runs = `${update.runsToday} ${update.runsToday === 1 ? 'run' : 'runs'} today`;
  const failed = update.failedToday > 0 ? `, ${update.failedToday} failed` : '';
  return `${update.name}: ${runs}${failed}`;
}

const SLOT_REASONS: Record<ScheduleSlotReason, string> = {
  previous_running: 'The previous run was still going',
  missed: 'Spark was closed or the Mac was asleep',
  paused: 'Spark was paused',
  problem: 'The workflow has a problem',
  project_gone: 'Its project is no longer in Spark',
  error: 'The run could not start',
};

export function scheduleSlotReasonLine(slot: Pick<ScheduleSlot, 'reason' | 'detail'>): string {
  const reason = slot.reason ? SLOT_REASONS[slot.reason] : '';
  if (!slot.detail) return reason;
  return reason ? `${reason}: ${slot.detail}` : slot.detail;
}

export interface DueInput {
  schedule: ScheduleTiming & { missed: ScheduleMissed };
  lastChecked: Date;
  now: Date;
  paused: boolean;
  heldSince: Date | null;
}

export type DueAction =
  | { kind: 'none' }
  | { kind: 'hold'; slotAt: Date; lastSlotAt: Date }
  | { kind: 'skip_missed'; slotAt: Date }
  | { kind: 'start'; source: ScheduleSlotSource; slotAt: Date };

export interface DueDecision {
  action: DueAction;
  release: boolean;
}

function onTimeSlot(input: DueInput): Date | null {
  const after = new Date(
    Math.max(input.lastChecked.getTime(), input.now.getTime() - SCHEDULE_LATE_MS),
  );
  const due = nextRuns(input.schedule, after, ON_TIME_SCAN).filter(
    (slot) => slot.getTime() <= input.now.getTime(),
  );
  return due.at(-1) ?? null;
}

export function decideDue(input: DueInput): DueDecision {
  const first = missedRun(input.schedule, input.lastChecked, input.now);
  const onTime = onTimeSlot(input);
  if (input.paused) {
    if (first === null) return { action: { kind: 'none' }, release: false };
    return { action: { kind: 'hold', slotAt: first, lastSlotAt: onTime ?? first }, release: false };
  }
  const release = input.heldSince !== null;
  if (onTime !== null) {
    return { action: { kind: 'start', source: 'schedule', slotAt: onTime }, release };
  }
  const owed = first ?? input.heldSince;
  if (owed === null) return { action: { kind: 'none' }, release };
  if (input.schedule.missed === 'run_once') {
    return { action: { kind: 'start', source: 'catch_up', slotAt: owed }, release };
  }
  if (first === null) return { action: { kind: 'none' }, release };
  return { action: { kind: 'skip_missed', slotAt: first }, release };
}
