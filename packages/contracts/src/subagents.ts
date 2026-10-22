import { z } from 'zod';
import { EventType, SPARK_METADATA, type RunEvent } from './run-events.ts';
import {
  SUBAGENT_REPORT,
  emptySubagentRecord,
  subagentRecordSchema,
  subagentReportSchema,
  withSubagentReport,
  withSubagentStep,
} from './subagent-report.ts';

export const SUBAGENTS_ACTIVITY = 'subagents';
export const SUBAGENT_CANCELLED_CODES: readonly string[] = ['cancelled', 'interrupted'];

export const subagentStateSchema = z.enum(['working', 'done', 'failed', 'cancelled']);
export type SubagentState = z.infer<typeof subagentStateSchema>;

export const subagentRowSchema = subagentRecordSchema.extend({
  id: z.string(),
  name: z.string(),
  task: z.string(),
  parentId: z.string().nullable(),
  state: subagentStateSchema,
  step: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
});
export type SubagentRow = z.infer<typeof subagentRowSchema>;

export const BACKGROUND_NAMES_SHOWN = 6;
export const BACKGROUND_NAME_MAX = 200;

export const backgroundWaitSchema = z.object({
  agents: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  names: z.array(z.string().max(BACKGROUND_NAME_MAX)).max(BACKGROUND_NAMES_SHOWN).default([]),
  wakesAt: z.number().int().positive().optional(),
});
export type BackgroundWait = z.infer<typeof backgroundWaitSchema>;

export const subagentWaitSchema = z.object({
  waitingOn: z.number().int().nonnegative(),
  background: backgroundWaitSchema.optional(),
});

export interface SubagentRoster {
  rows: readonly SubagentRow[];
  waitingOn: number;
  background: BackgroundWait | null;
  openSteps: Readonly<Record<string, readonly string[]>>;
}

export const emptySubagentRoster: SubagentRoster = {
  rows: [],
  waitingOn: 0,
  background: null,
  openSteps: {},
};

const GENERATION_MARK = ':generation:';

export function firstGenerationId(id: string): string {
  const at = id.indexOf(GENERATION_MARK);
  return at < 0 ? id : id.slice(0, at);
}

const ownMarkSchema = z.object({ ownSubagent: z.literal(true) });

export const OWN_SUBAGENT_METADATA = { [SPARK_METADATA]: { ownSubagent: true } } as const;

function isOwn(event: { metadata?: Record<string, unknown> | undefined }): boolean {
  return ownMarkSchema.safeParse(event.metadata?.[SPARK_METADATA]).success;
}

function changeRow(
  roster: SubagentRoster,
  id: string,
  change: (row: SubagentRow) => SubagentRow,
): SubagentRoster {
  return { ...roster, rows: roster.rows.map((row) => (row.id === id ? change(row) : row)) };
}

function ended(
  roster: SubagentRoster,
  id: string,
  state: SubagentState,
  at: number | undefined,
): SubagentRoster {
  const row = roster.rows.find((entry) => entry.id === id);
  if (!row || row.state !== 'working') return roster;
  const openSteps = Object.fromEntries(
    Object.entries(roster.openSteps).filter(([open]) => open !== id),
  );
  const next = changeRow(roster, id, (entry) => ({
    ...entry,
    state,
    step: null,
    endedAt: at ?? null,
  }));
  return { ...next, openSteps };
}

function withSteps(
  roster: SubagentRoster,
  id: string,
  steps: readonly string[],
  name: string,
  started: boolean,
): SubagentRoster {
  const next = changeRow(roster, id, (row) => ({
    ...withSubagentStep(row, name, started),
    step: steps.at(-1) ?? null,
  }));
  return { ...next, openSteps: { ...roster.openSteps, [id]: steps } };
}

function attributedStep(
  roster: SubagentRoster,
  id: string | undefined,
  name: string,
  started: boolean,
): SubagentRoster {
  if (!id || !roster.rows.some((row) => row.id === id && row.state === 'working')) return roster;
  const open = roster.openSteps[id] ?? [];
  if (started) return withSteps(roster, id, [...open, name], name, true);
  const index = open.indexOf(name);
  if (index < 0) return roster;
  return withSteps(roster, id, [...open.slice(0, index), ...open.slice(index + 1)], name, false);
}

function errorState(code: string | undefined): SubagentState {
  return code !== undefined && SUBAGENT_CANCELLED_CODES.includes(code) ? 'cancelled' : 'failed';
}

function rowIdFor(roster: SubagentRoster, id: string): string {
  const first = firstGenerationId(id);
  return roster.rows.some((row) => row.id === first) ? first : id;
}

function resumed(roster: SubagentRoster, id: string): SubagentRoster {
  return changeRow(roster, id, (row) =>
    row.state === 'working' ? row : { ...row, state: 'working', step: null, endedAt: null },
  );
}

function withRowIds(roster: SubagentRoster, event: RunEvent): RunEvent {
  switch (event.type) {
    case EventType.SUBAGENT_FINISHED:
    case EventType.SUBAGENT_ERROR:
      return { ...event, subagentRunId: rowIdFor(roster, event.subagentRunId) };
    case EventType.STEP_STARTED:
    case EventType.STEP_FINISHED:
      return event.subagentRunId
        ? { ...event, subagentRunId: rowIdFor(roster, event.subagentRunId) }
        : event;
    default:
      return event;
  }
}

export function applySubagentEvent(roster: SubagentRoster, raw: RunEvent): SubagentRoster {
  const event = withRowIds(roster, raw);
  switch (event.type) {
    case EventType.SUBAGENT_STARTED: {
      if (!isOwn(event)) return roster;
      const first = firstGenerationId(event.subagentRunId);
      if (first !== event.subagentRunId && roster.rows.some((row) => row.id === first)) {
        return resumed(roster, first);
      }
      if (roster.rows.some((row) => row.id === event.subagentRunId)) return roster;
      const row: SubagentRow = {
        ...emptySubagentRecord,
        id: event.subagentRunId,
        name: event.name,
        task: event.description ?? '',
        parentId: event.parentSubagentRunId ?? null,
        state: 'working',
        step: null,
        startedAt: event.timestamp ?? null,
        endedAt: null,
      };
      return { ...roster, rows: [...roster.rows, row] };
    }
    case EventType.SUBAGENT_FINISHED:
      return ended(roster, event.subagentRunId, 'done', event.timestamp);
    case EventType.SUBAGENT_ERROR:
      return ended(roster, event.subagentRunId, errorState(event.code), event.timestamp);
    case EventType.STEP_STARTED:
      return attributedStep(roster, event.subagentRunId, event.stepName, true);
    case EventType.STEP_FINISHED:
      return attributedStep(roster, event.subagentRunId, event.stepName, false);
    case EventType.CUSTOM: {
      const report =
        event.name === SUBAGENT_REPORT ? subagentReportSchema.safeParse(event.value) : null;
      if (!report?.success) return roster;
      const id = rowIdFor(roster, report.data.id);
      if (!roster.rows.some((row) => row.id === id)) return roster;
      return changeRow(roster, id, (row) => withSubagentReport(row, { ...report.data, id }));
    }
    case EventType.ACTIVITY_SNAPSHOT: {
      if (event.activityType !== SUBAGENTS_ACTIVITY) return roster;
      const wait = subagentWaitSchema.safeParse(event.content);
      if (!wait.success) return roster;
      const background = wait.data.background ?? null;
      const same =
        wait.data.waitingOn === roster.waitingOn &&
        JSON.stringify(background) === JSON.stringify(roster.background);
      return same ? roster : { ...roster, waitingOn: wait.data.waitingOn, background };
    }
    case EventType.RUN_FINISHED:
    case EventType.RUN_ERROR:
      return roster.waitingOn === 0 && roster.background === null
        ? roster
        : { ...roster, waitingOn: 0, background: null };
    default:
      return roster;
  }
}

export function subagentCount(count: number): string {
  return count === 1 ? '1 sub-agent' : `${count} sub-agents`;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export type TimeFormat = (at: number) => string;

export function wakeTime(wakesAt: number): string {
  return new Date(wakesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function waitedOn(
  count: number,
  background?: BackgroundWait | null,
  time: TimeFormat = wakeTime,
): string {
  if (!background) return subagentCount(count);
  const agents = background.agents > 0 ? counted(background.agents, 'background agent') : null;
  const tasks = background.tasks > 0 ? counted(background.tasks, 'background task') : null;
  const wakeup =
    background.wakesAt === undefined ? null : `a wakeup at ${time(background.wakesAt)}`;
  return [agents, tasks, wakeup].filter((part) => part !== null).join(' and ');
}

export function waitingOnLabel(
  count: number,
  background?: BackgroundWait | null,
  time: TimeFormat = wakeTime,
): string {
  if (background?.wakesAt !== undefined && background.agents + background.tasks === 0) {
    return `Sleeping until ${time(background.wakesAt)}`;
  }
  return `Waiting on ${waitedOn(count, background, time)}`;
}

export function agentsWorkingLabel(working: number, total: number): string {
  return `${working} of ${total} ${total === 1 ? 'agent' : 'agents'} working`;
}

export function rosterCounts(roster: SubagentRoster): { working: number; total: number } {
  const working = roster.rows.filter((row) => row.state === 'working').length;
  return { working, total: roster.rows.length };
}
