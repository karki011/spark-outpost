import type { SessionEvent } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewSessionEvent {
  conversationId: string;
  sessionRowId: string | null;
  runId: string;
  event: SessionEvent;
}

export async function insertSessionEvent(db: Queryable, row: NewSessionEvent): Promise<void> {
  await db.query(
    `INSERT INTO provider_session_events
       (id, conversation_id, session_row_id, run_id, event, reason, body)
     SELECT $1, $2, $3, $4, $5, $6, $7
     WHERE EXISTS (SELECT 1 FROM conversations WHERE id = $2)`,
    [
      newId(),
      row.conversationId,
      row.sessionRowId,
      row.runId,
      row.event.event,
      row.event.reason,
      JSON.stringify(row.event),
    ],
  );
}

export async function recordAppliedSettings(
  db: Queryable,
  sessionRowId: string,
  applied: { model: string | null; mode: string | null },
): Promise<void> {
  await db.query('UPDATE provider_sessions SET model = $2, agent_mode = $3 WHERE id = $1', [
    sessionRowId,
    applied.model,
    applied.mode,
  ]);
}

export interface SessionEventRow {
  runId: string | null;
  userMessageId: string | null;
  at: Date;
  body: unknown;
}

export async function conversationSessionEvents(
  db: Queryable,
  conversationId: string,
): Promise<SessionEventRow[]> {
  const { rows } = await db.query<{
    run_id: string | null;
    user_message_id: string | null;
    at: Date;
    body: unknown;
  }>(
    `SELECT e.run_id, r.user_message_id, e.at, e.body
     FROM provider_session_events e LEFT JOIN runs r ON r.id = e.run_id
     WHERE e.conversation_id = $1 ORDER BY e.at, e.id`,
    [conversationId],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    userMessageId: row.user_message_id,
    at: row.at,
    body: row.body,
  }));
}
