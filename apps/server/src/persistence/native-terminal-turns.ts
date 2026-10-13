import type {
  NativeTerminalProvider,
  NativeTerminalSession,
  RunEvent,
} from '@spark-outpost/contracts';
import { runEvents } from '../workflow/run-events.ts';
import { expirePendingApprovals } from './approvals.ts';
import { writeArtifact } from './artifacts.ts';
import { withTransaction, type Db, type DbClient } from './db.ts';
import { notifyNativeTerminal, type NativeTerminalRow } from './native-terminals.ts';
import { insertRunEvent, type AppendOptions } from './run-events.ts';

export interface NativeFence {
  id: string;
  generation: number;
}

export class NativeTerminalConflictError extends Error {}

interface NativeLaunchReservation {
  id: string;
  conversationId: string;
  provider: NativeTerminalProvider;
  cwd: string;
  label: string;
  runId: string | null;
  messageId: string | null;
  resume: boolean;
  observation: NativeTerminalSession['observation'];
  reason: string | null;
}

const endedStates = new Set(['exited', 'error', 'interrupted']);

async function lockSession(
  client: DbClient,
  fence: NativeFence,
): Promise<NativeTerminalRow | null> {
  const { rows } = await client.query<NativeTerminalRow>(
    'SELECT * FROM native_terminal_sessions WHERE id = $1 AND generation = $2 FOR UPDATE',
    [fence.id, fence.generation],
  );
  return rows[0] ?? null;
}

export async function reserveNativeTerminalLaunch(
  db: Db,
  input: NativeLaunchReservation,
): Promise<NativeTerminalRow> {
  return withTransaction(db, async (client) => {
    const owned = await client.query<{ session_type: string }>(
      'SELECT session_type FROM conversations WHERE id = $1 FOR UPDATE',
      [input.conversationId],
    );
    if (owned.rows[0]?.session_type !== 'terminal')
      throw new NativeTerminalConflictError('Open a Terminal session first.');
    const current = await client.query<NativeTerminalRow>(
      'SELECT * FROM native_terminal_sessions WHERE conversation_id = $1 FOR UPDATE',
      [input.conversationId],
    );
    const previous = current.rows[0];
    if (previous && !endedStates.has(previous.state))
      throw new NativeTerminalConflictError('That terminal agent is already running.');
    if (previous?.native_session_id && !input.resume)
      throw new NativeTerminalConflictError('Resume the interrupted or ended terminal explicitly.');
    if (input.resume && (!previous?.native_session_id || previous.provider !== input.provider)) {
      throw new NativeTerminalConflictError('This terminal has no native session to resume.');
    }
    const { rows } = await client.query<NativeTerminalRow>(
      `INSERT INTO native_terminal_sessions
        (id, conversation_id, provider, state, cwd, label, active_run_id, launch_message_id, observation, reason)
       VALUES ($1, $2, $3, 'starting', $4, $5, $6, $7, $8, $9)
       ON CONFLICT (conversation_id) DO UPDATE SET state = 'starting', cwd = EXCLUDED.cwd,
         label = EXCLUDED.label, active_run_id = EXCLUDED.active_run_id,
         launch_message_id = EXCLUDED.launch_message_id, generation = native_terminal_sessions.generation + 1,
         native_turn_id = NULL, observation = EXCLUDED.observation, reason = EXCLUDED.reason, updated_at = now()
       RETURNING *`,
      [
        input.id,
        input.conversationId,
        input.provider,
        input.cwd,
        input.label,
        input.runId,
        input.messageId,
        input.observation,
        input.reason,
      ],
    );
    await notifyNativeTerminal(client, input.conversationId);
    return rows[0]!;
  });
}

export async function setNativeTerminalState(
  db: Db,
  input: NativeFence & {
    state: NativeTerminalSession['state'];
    reason?: string | null;
    nativeSessionId?: string;
    nativeTurnId?: string;
  },
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const row = await lockSession(client, input);
    if (!row || (endedStates.has(row.state) && !endedStates.has(input.state))) return false;
    await client.query(
      `UPDATE native_terminal_sessions SET state = $3, reason = $4,
         native_session_id = COALESCE($5, native_session_id), native_turn_id = COALESCE($6, native_turn_id), updated_at = now()
       WHERE id = $1 AND generation = $2`,
      [
        input.id,
        input.generation,
        input.state,
        input.reason ?? null,
        input.nativeSessionId ?? null,
        input.nativeTurnId ?? null,
      ],
    );
    await notifyNativeTerminal(client, row.conversation_id);
    return true;
  });
}

export async function acceptNativeEvent(
  db: Db,
  input: NativeFence & { eventId: string },
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const row = await lockSession(client, input);
    if (!row || endedStates.has(row.state)) return false;
    const accepted = await client.query(
      `INSERT INTO native_terminal_events (session_id, generation, event_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [input.id, input.generation, input.eventId],
    );
    return accepted.rowCount === 1;
  });
}

export async function setNativeRun(
  db: Db,
  input: NativeFence & { runId: string; nativeTurnId?: string },
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const row = await lockSession(client, input);
    if (!row || endedStates.has(row.state)) return false;
    if (row.active_run_id && row.active_run_id !== input.runId)
      throw new NativeTerminalConflictError('Finish the current terminal turn first.');
    const started = await client.query<{ status: string }>(
      `SELECT status FROM runs WHERE id = $1 AND conversation_id = $2 AND provider = $3
         AND cancel_requested_at IS NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE run_id = $1) FOR UPDATE`,
      [input.runId, row.conversation_id, row.provider],
    );
    if (
      !started.rows[0] ||
      !['queued', 'running', 'awaiting_approval'].includes(started.rows[0].status)
    )
      return false;
    if (started.rows[0].status === 'queued') {
      await client.query(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`, [
        input.runId,
      ]);
      await insertRunEvent(
        client,
        input.runId,
        runEvents.started({ runId: input.runId, threadId: row.conversation_id }),
      );
    }
    await client.query(
      `UPDATE native_terminal_sessions SET active_run_id = $3, native_turn_id = $4, updated_at = now()
      WHERE id = $1 AND generation = $2`,
      [input.id, input.generation, input.runId, input.nativeTurnId ?? row.native_turn_id],
    );
    await notifyNativeTerminal(client, row.conversation_id);
    await client.query(`SELECT pg_notify('run_events', $1)`, [input.runId]);
    return true;
  });
}

export async function appendNativeRun(
  db: Db,
  fence: NativeFence & { runId: string },
  event: RunEvent,
  options: AppendOptions = {},
): Promise<number | null> {
  return withTransaction(db, async (client) => {
    const row = await lockSession(client, fence);
    if (!row || row.active_run_id !== fence.runId || endedStates.has(row.state)) return null;
    const run = await client.query<{ status: string }>(
      'SELECT status FROM runs WHERE id = $1 FOR UPDATE',
      [fence.runId],
    );
    if (!['running', 'awaiting_approval'].includes(run.rows[0]?.status ?? '')) return null;
    const seq = await insertRunEvent(client, fence.runId, event);
    if (options.assistantMessage)
      await client.query(
        `INSERT INTO messages (id, conversation_id, role, content, run_id) VALUES ($1, $2, 'assistant', $3, $4)`,
        [
          options.assistantMessage.id,
          row.conversation_id,
          options.assistantMessage.content,
          fence.runId,
        ],
      );
    if (options.artifact) await writeArtifact(client, fence.runId, options.artifact);
    if (options.transition) {
      if (!['running', 'awaiting_approval'].includes(options.transition.status))
        throw new NativeTerminalConflictError('Finish terminal turns through their session owner.');
      await client.query('UPDATE runs SET status = $2, error = $3 WHERE id = $1', [
        fence.runId,
        options.transition.status,
        options.transition.error ?? null,
      ]);
    }
    await client.query(`SELECT pg_notify('run_events', $1)`, [fence.runId]);
    await notifyNativeTerminal(client, row.conversation_id);
    return seq;
  });
}

export type NativeRunOutcome = 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';

async function finishLockedRun(
  client: DbClient,
  row: NativeTerminalRow,
  requested: NativeRunOutcome,
  reason?: string,
): Promise<void> {
  if (!row.active_run_id) return;
  const runId = row.active_run_id;
  const neverStarted = await client.query(
    `SELECT 1 FROM runs WHERE id = $1 AND status = 'queued' FOR UPDATE`,
    [runId],
  );
  const status: NativeRunOutcome =
    neverStarted.rowCount === 1 && requested === 'outcome_unknown' ? 'failed' : requested;
  const ended = await client.query(
    `UPDATE runs SET status = $2, error = $3, started_at = COALESCE(started_at, now()), finished_at = now()
     WHERE id = $1 AND status IN ('queued', 'running', 'awaiting_approval') RETURNING id`,
    [runId, status, reason ?? null],
  );
  if (ended.rowCount === 1) {
    const identity = { runId, threadId: row.conversation_id };
    await insertRunEvent(
      client,
      runId,
      status === 'succeeded'
        ? runEvents.finished(identity)
        : status === 'cancelled'
          ? runEvents.cancelled(identity)
          : runEvents.error(reason ?? 'The terminal turn ended.', status),
    );
    if (status !== 'succeeded')
      await expirePendingApprovals(
        client,
        runId,
        status === 'outcome_unknown' ? 'recovery' : 'stop',
      );
    await client.query(`SELECT pg_notify('run_events', $1)`, [runId]);
  }
  await client.query(
    'UPDATE native_terminal_sessions SET active_run_id = NULL, updated_at = now() WHERE id = $1',
    [row.id],
  );
}

export async function finishNativeRun(
  db: Db,
  fence: NativeFence,
  status: NativeRunOutcome,
  reason?: string,
): Promise<void> {
  await withTransaction(db, async (client) => {
    const row = await lockSession(client, fence);
    if (!row) return;
    await finishLockedRun(client, row, status, reason);
    await notifyNativeTerminal(client, row.conversation_id);
  });
}

async function failUnstartedRuns(
  client: DbClient,
  reason: string,
  runId: string | null,
): Promise<void> {
  const failed = await client.query<{ id: string; conversation_id: string }>(
    `UPDATE runs r SET status = 'failed', error = $1, started_at = COALESCE(r.started_at, now()), finished_at = now()
     FROM conversations c WHERE c.id = r.conversation_id AND c.session_type = 'terminal'
       AND r.status = 'queued' AND ($2::uuid IS NULL OR r.id = $2)
       AND NOT EXISTS (SELECT 1 FROM jobs WHERE run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM native_terminal_sessions n WHERE n.active_run_id = r.id)
     RETURNING r.id, r.conversation_id`,
    [reason, runId],
  );
  for (const row of failed.rows) {
    await insertRunEvent(client, row.id, runEvents.error(reason, 'failed'));
    await client.query(`SELECT pg_notify('run_events', $1)`, [row.id]);
    await notifyNativeTerminal(client, row.conversation_id);
  }
}

export async function failNativeLaunchRun(db: Db, runId: string, reason: string): Promise<void> {
  await withTransaction(db, (client) => failUnstartedRuns(client, reason, runId));
}

export async function requeueNativeLaunchRun(db: Db, runId: string): Promise<boolean> {
  const requeued = await db.query(
    `UPDATE runs r SET status = 'queued', error = NULL, started_at = NULL, finished_at = NULL
     FROM conversations c WHERE r.id = $1 AND c.id = r.conversation_id AND c.session_type = 'terminal'
       AND r.status IN ('failed', 'outcome_unknown') AND r.cancel_requested_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM jobs WHERE run_id = r.id)
       AND NOT EXISTS (
         SELECT 1 FROM native_terminal_sessions n
         WHERE n.conversation_id = c.id
           AND (n.native_session_id IS NOT NULL OR n.state NOT IN ('exited', 'error', 'interrupted'))
       )`,
    [runId],
  );
  return requeued.rowCount === 1;
}

export async function recoverNativeTerminals(
  db: Db,
  keptSessionIds: readonly string[] = [],
): Promise<void> {
  await withTransaction(db, async (client) => {
    const { rows } = await client.query<NativeTerminalRow>(
      `SELECT * FROM native_terminal_sessions
       WHERE state NOT IN ('exited', 'error', 'interrupted') AND NOT (id = ANY($1::uuid[]))
       FOR UPDATE`,
      [keptSessionIds],
    );
    const reason = 'The terminal host stopped. Resume explicitly to continue the native session.';
    for (const row of rows) {
      await finishLockedRun(client, row, 'outcome_unknown', reason);
      await client.query(
        `UPDATE native_terminal_sessions SET state = 'interrupted', reason = $2, updated_at = now() WHERE id = $1`,
        [row.id, reason],
      );
      await notifyNativeTerminal(client, row.conversation_id);
    }
    const orphaned = await client.query<{ id: string; conversation_id: string }>(
      `UPDATE runs r SET status = 'outcome_unknown', error = $1, finished_at = now()
       FROM conversations c WHERE c.id = r.conversation_id AND c.session_type = 'terminal'
         AND r.status IN ('running', 'awaiting_approval')
         AND r.conversation_id NOT IN (
           SELECT conversation_id FROM native_terminal_sessions WHERE id = ANY($2::uuid[]))
       RETURNING r.id, r.conversation_id`,
      [reason, keptSessionIds],
    );
    for (const row of orphaned.rows) {
      await expirePendingApprovals(client, row.id, 'recovery');
      await insertRunEvent(client, row.id, runEvents.error(reason, 'outcome_unknown'));
      await client.query(`SELECT pg_notify('run_events', $1)`, [row.id]);
      await notifyNativeTerminal(client, row.conversation_id);
    }
    await failUnstartedRuns(
      client,
      'The terminal was not started before Spark stopped. Open the session to start it.',
      null,
    );
  });
}

export async function retractNativeRun(
  db: Db,
  fence: NativeFence,
  runId: string,
  ownerRunId: string,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const row = await lockSession(client, fence);
    const run = await client.query<{ user_message_id: string | null }>(
      'SELECT user_message_id FROM runs WHERE id = $1 AND conversation_id = $2 FOR UPDATE',
      [runId, row?.conversation_id ?? null],
    );
    if (!row || !run.rows[0]) return false;
    await client.query(
      `UPDATE native_terminal_steps s SET run_id = $2 WHERE s.run_id = $1 AND NOT EXISTS (
         SELECT 1 FROM native_terminal_steps o WHERE o.run_id = $2 AND o.tool_use_id = s.tool_use_id)`,
      [runId, ownerRunId],
    );
    await client.query(
      'UPDATE native_terminal_sessions SET active_run_id = NULL WHERE id = $1 AND active_run_id = $2',
      [row.id, runId],
    );
    await client.query('DELETE FROM runs WHERE id = $1', [runId]);
    if (run.rows[0].user_message_id)
      await client.query('DELETE FROM messages WHERE id = $1', [run.rows[0].user_message_id]);
    await notifyNativeTerminal(client, row.conversation_id);
    return true;
  });
}
