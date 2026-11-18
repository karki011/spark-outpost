import type { TerminalMeasure } from '@spark-outpost/contracts';
import type { Db } from './db.ts';
import { notifyNativeTerminal } from './native-terminals.ts';

export type ModMeasure = Omit<TerminalMeasure, 'at'> & { at: number };

export interface SessionEnd {
  reason: string;
  resumeId: string | null;
  at: Date;
}

export async function recordModMeasure(
  db: Db,
  sessionId: string,
  { at, ...measure }: ModMeasure,
): Promise<void> {
  await db.query(
    `UPDATE native_terminal_sessions SET measure = $2::jsonb, measured_at = $3
     WHERE id = $1 AND (measured_at IS NULL OR measured_at < $3)`,
    [sessionId, JSON.stringify(measure), new Date(at)],
  );
}

export async function recordSessionEnd(db: Db, sessionId: string, end: SessionEnd): Promise<void> {
  const { rows } = await db.query<{ conversation_id: string }>(
    `UPDATE native_terminal_sessions
     SET ended_reason = $2, ended_resume_id = COALESCE($3, ended_resume_id), ended_at = $4
     WHERE id = $1 AND (ended_at IS NULL OR ended_at <= $4)
     RETURNING conversation_id`,
    [sessionId, end.reason, end.resumeId, end.at],
  );
  if (rows[0]) await notifyNativeTerminal(db, rows[0].conversation_id);
}

export async function setModHealth(
  db: Db,
  session: { id: string; generation: number },
  state: 'loaded' | 'missing',
  reason: string | null,
): Promise<boolean> {
  const { rows } = await db.query<{ conversation_id: string }>(
    `UPDATE native_terminal_sessions SET mod_state = $3, mod_reason = $4, mod_generation = $2
     WHERE id = $1 AND generation = $2 AND (mod_generation IS DISTINCT FROM $2
       OR mod_state IS DISTINCT FROM $3 OR mod_reason IS DISTINCT FROM $4)
     RETURNING conversation_id`,
    [session.id, session.generation, state, reason],
  );
  if (!rows[0]) return false;
  await notifyNativeTerminal(db, rows[0].conversation_id);
  return true;
}
