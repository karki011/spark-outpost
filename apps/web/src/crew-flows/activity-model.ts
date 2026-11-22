import type {
  PublishHold,
  ScheduleSlot,
  TriggerEvent,
  WorkflowRun,
} from '@spark-outpost/contracts';
import type { HourCycle } from '../calendar/clock-format.ts';
import { historyRows, whenLine, type HistoryTone } from './schedule-model.ts';
import { eventRow, holdLine } from './triggers-model.ts';

export interface ActivityRow {
  key: string;
  at: number;
  when: string;
  how: string;
  state: string;
  tone: HistoryTone;
  note: string;
  took: string;
  runId: string | null;
  holdId: string | null;
}

export interface Activity {
  runs: readonly WorkflowRun[];
  slots: readonly ScheduleSlot[];
  events: readonly TriggerEvent[];
  holds: readonly PublishHold[];
}

function holdRow(hold: PublishHold, now: Date, cycle: HourCycle): ActivityRow {
  const at = new Date(hold.createdAt);
  return {
    key: `hold:${hold.id}`,
    at: at.getTime(),
    when: whenLine(at, now, cycle),
    how: 'Before publish',
    state: 'Held publish',
    tone: 'failed',
    note: `${hold.chatTitle || 'Untitled chat'} · ${holdLine(hold)}`,
    took: '',
    runId: null,
    holdId: hold.id,
  };
}

function waitingEventRow(event: TriggerEvent, now: Date, cycle: HourCycle): ActivityRow {
  const row = eventRow(event, now, cycle);
  return {
    key: `event:${row.key}`,
    at: row.at,
    when: row.when,
    how: `Triggered · ${row.what}`,
    state: row.state,
    tone: row.tone,
    note: row.note ? `${row.chat} · ${row.note}` : row.chat,
    took: '',
    runId: null,
    holdId: null,
  };
}

export function activityRows(activity: Activity, now: Date, cycle: HourCycle): ActivityRow[] {
  const unstarted = activity.events.filter((event) => event.workflowRunId === null);
  const open = activity.holds.filter((hold) => hold.state === 'open');
  return [
    ...open.map((hold) => holdRow(hold, now, cycle)),
    ...[
      ...historyRows(activity.runs, activity.slots, now, cycle).map((row) => ({
        ...row,
        holdId: null,
      })),
      ...unstarted.map((event) => waitingEventRow(event, now, cycle)),
    ].toSorted((a, b) => b.at - a.at),
  ];
}
