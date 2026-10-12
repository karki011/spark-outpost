import { z } from 'zod';
import { EventType, SPARK_METADATA, type RunEvent } from './run-events.ts';

export const SUBAGENTS_ACTIVITY = 'subagents';
export const SUBAGENT_CANCELLED_CODES: readonly string[] = ['cancelled', 'interrupted'];

export const subagentStateSchema = z.enum(['working', 'done', 'failed', 'cancelled']);
export type SubagentState = z.infer<typeof subagentStateSchema>;

export const subagentRowSchema = z.object({
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

export const subagentWaitSchema = z.object({ waitingOn: z.number().int().nonnegative() });

export interface SubagentRoster {
  rows: readonly SubagentRow[];
  waitingOn: number;
  openSteps: Readonly<Record<string, readonly string[]>>;
}

export const emptySubagentRoster: SubagentRoster = { rows: [], waitingOn: 0, openSteps: {} };

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

function withSteps(roster: SubagentRoster, id: string, steps: readonly string[]): SubagentRoster {
  const next = changeRow(roster, id, (row) => ({ ...row, step: steps.at(-1) ?? null }));
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
  if (started) return withSteps(roster, id, [...open, name]);
  const index = open.indexOf(name);
  if (index < 0) return roster;
  return withSteps(roster, id, [...open.slice(0, index), ...open.slice(index + 1)]);
}

function errorState(code: string | undefined): SubagentState {
  return code !== undefined && SUBAGENT_CANCELLED_CODES.includes(code) ? 'cancelled' : 'failed';
}

export function applySubagentEvent(roster: SubagentRoster, event: RunEvent): SubagentRoster {
  switch (event.type) {
    case EventType.SUBAGENT_STARTED: {
      if (!isOwn(event) || roster.rows.some((row) => row.id === event.subagentRunId)) return roster;
      const row: SubagentRow = {
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
    case EventType.ACTIVITY_SNAPSHOT: {
      if (event.activityType !== SUBAGENTS_ACTIVITY) return roster;
      const wait = subagentWaitSchema.safeParse(event.content);
      if (!wait.success || wait.data.waitingOn === roster.waitingOn) return roster;
      return { ...roster, waitingOn: wait.data.waitingOn };
    }
    case EventType.RUN_FINISHED:
    case EventType.RUN_ERROR:
      return roster.waitingOn === 0 ? roster : { ...roster, waitingOn: 0 };
    default:
      return roster;
  }
}

export function subagentCount(count: number): string {
  return count === 1 ? '1 sub-agent' : `${count} sub-agents`;
}

export function waitingOnLabel(count: number): string {
  return `Waiting on ${subagentCount(count)}`;
}

const SUMMARY_ORDER: readonly SubagentState[] = ['working', 'done', 'failed', 'cancelled'];

export function subagentSummary(rows: readonly Pick<SubagentRow, 'state'>[]): string {
  const parts = SUMMARY_ORDER.flatMap((state) => {
    const count = rows.filter((row) => row.state === state).length;
    return count > 0 ? [`${count} ${state}`] : [];
  });
  return `${subagentCount(rows.length)} · ${parts.join(', ')}`;
}
