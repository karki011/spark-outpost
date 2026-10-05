import type { Interruption, InterruptionBlock, InterruptionChoice } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export type InterruptionRefusal =
  'not_interrupted' | 'settling' | 'newer_turn' | 'started_fresh' | 'continued' | 'crew';

const REFUSALS: Record<InterruptionRefusal, string> = {
  not_interrupted: "This turn wasn't interrupted, so there is nothing to continue.",
  settling: 'Spark is still checking what happened to this turn. Try again in a moment.',
  newer_turn: 'A newer turn has started in this chat, so this one can no longer be continued.',
  started_fresh: 'You chose to start fresh after this turn, so it can no longer be continued.',
  continued: 'This turn was already continued.',
  crew: "This turn ran as a crew of several agents, and Spark can't resume a crew part-way yet. Start fresh instead.",
};

export class InterruptionError extends Error {
  constructor(readonly refusal: InterruptionRefusal) {
    super(REFUSALS[refusal]);
  }
}

export class InterruptedRunNotFoundError extends Error {
  constructor() {
    super('Run not found.');
  }
}

export interface InterruptedState {
  runId: string;
  conversationId: string;
  status: string;
  role: string | null;
  finishedAt: Date | null;
  choice: InterruptionChoice | null;
  newerTurn: boolean;
  continuedBy: string | null;
  settling: boolean;
  crew: boolean;
}

interface StateRow {
  id: string;
  conversation_id: string;
  status: string;
  role: string | null;
  finished_at: Date | null;
  interruption_choice: InterruptionChoice | null;
  newer_turn: boolean;
  continued_by: string | null;
  settling: boolean;
  crew: boolean;
}

const STATE_COLUMNS = `r.id, r.conversation_id, r.status, r.role, r.finished_at, r.interruption_choice,
  EXISTS (
    SELECT 1 FROM runs n
    WHERE n.conversation_id = r.conversation_id AND n.parent_run_id IS NULL
      AND (n.created_at, n.id) > (r.created_at, r.id)
  ) AS newer_turn,
  (SELECT c.id FROM runs c WHERE c.continues_run_id = r.id) AS continued_by,
  EXISTS (
    SELECT 1 FROM runs child
    WHERE child.parent_run_id = r.id
      AND child.status IN ('queued', 'running', 'awaiting_approval')
  ) AS settling,
  EXISTS (
    SELECT 1 FROM runs child
    WHERE child.parent_run_id = r.id
      AND (child.role IN ('coordinator', 'integrator', 'spark') OR child.route ? 'guard')
  ) AS crew`;

function toState(row: StateRow): InterruptedState {
  return {
    runId: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    role: row.role,
    finishedAt: row.finished_at,
    choice: row.interruption_choice,
    newerTurn: row.newer_turn,
    continuedBy: row.continued_by,
    settling: row.settling,
    crew: row.crew,
  };
}

export async function interruptedState(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<InterruptedState> {
  const { rows } = await db.query<StateRow>(
    `SELECT ${STATE_COLUMNS} FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $1 AND c.workspace_id = $2 AND r.parent_run_id IS NULL`,
    [runId, workspaceId],
  );
  if (!rows[0]) throw new InterruptedRunNotFoundError();
  return toState(rows[0]);
}

export function continueRefusal(state: InterruptedState): InterruptionRefusal | null {
  if (state.role === 'digest') return 'not_interrupted';
  if (state.status !== 'outcome_unknown') {
    return state.status === 'running' || state.status === 'awaiting_approval'
      ? 'settling'
      : 'not_interrupted';
  }
  if (state.newerTurn) return 'newer_turn';
  if (state.choice === 'fresh') return 'started_fresh';
  if (state.settling) return 'settling';
  if (state.crew) return 'crew';
  return null;
}

function blockOf(state: InterruptedState): InterruptionBlock | null {
  return state.crew ? 'crew' : null;
}

export async function findInterruption(
  db: Queryable,
  conversationId: string,
): Promise<Interruption | null> {
  const { rows } = await db.query<StateRow>(
    `SELECT ${STATE_COLUMNS} FROM runs r
     WHERE r.conversation_id = $1 AND r.parent_run_id IS NULL
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [conversationId],
  );
  const state = rows[0] ? toState(rows[0]) : null;
  if (!state || state.status !== 'outcome_unknown' || state.role === 'digest') return null;
  if (state.choice !== null || state.continuedBy !== null || state.settling) return null;
  return {
    runId: state.runId,
    stoppedAt: state.finishedAt ? state.finishedAt.toISOString() : null,
    blocked: blockOf(state),
  };
}

export async function recordChoice(
  db: Queryable,
  runId: string,
  choice: InterruptionChoice,
): Promise<void> {
  await db.query(
    `UPDATE runs SET interruption_choice = $2, interruption_chosen_at = now()
     WHERE id = $1 AND interruption_choice IS NULL`,
    [runId, choice],
  );
}
