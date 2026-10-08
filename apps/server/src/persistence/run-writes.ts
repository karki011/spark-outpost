import { EventType, FILE_FOCUS_ACTIVITY } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface PieceEdit {
  pieceKey: string;
  path: string;
}

export interface PieceCommand {
  pieceKey: string;
  command: string;
  cwd: string | null;
}

export async function pieceToolEdits(db: Queryable, parentRunId: string): Promise<PieceEdit[]> {
  const { rows } = await db.query<{ piece_key: string; path: string }>(
    `SELECT DISTINCT r.route->>'pieceKey' AS piece_key, e.payload #>> '{content,path}' AS path
     FROM runs r JOIN run_events e ON e.run_id = r.id
     WHERE r.parent_run_id = $1 AND r.route->>'pieceKey' IS NOT NULL
       AND e.type = $2 AND e.payload->>'activityType' = $3
       AND e.payload #>> '{content,action}' = 'edit'`,
    [parentRunId, EventType.ACTIVITY_SNAPSHOT, FILE_FOCUS_ACTIVITY],
  );
  return rows.map((row) => ({ pieceKey: row.piece_key, path: row.path }));
}

export async function pieceCommands(db: Queryable, parentRunId: string): Promise<PieceCommand[]> {
  const { rows } = await db.query<{ piece_key: string; command: string; cwd: string | null }>(
    `SELECT r.route->>'pieceKey' AS piece_key, c.command, c.cwd
     FROM runs r JOIN run_commands c ON c.run_id = r.id
     WHERE r.parent_run_id = $1 AND r.route->>'pieceKey' IS NOT NULL
     ORDER BY c.started_at, c.id`,
    [parentRunId],
  );
  return rows.map((row) => ({ pieceKey: row.piece_key, command: row.command, cwd: row.cwd }));
}

export interface RunEditDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

export interface RunEditRecord {
  diffs: RunEditDiff[];
  cut: boolean;
}

const SESSION_UPDATE = 'session/update';

export async function runEditDiffs(db: Queryable, runId: string): Promise<RunEditRecord> {
  const { rows } = await db.query<{
    call: string | null;
    path: string | null;
    old_text: string | null;
    new_text: string | null;
  }>(
    `SELECT l.payload #>> '{params,update,toolCallId}' AS call, d.value->>'path' AS path,
       d.value->>'oldText' AS old_text, d.value->>'newText' AS new_text
     FROM run_protocol_log l,
       jsonb_path_query(l.payload, '$.params.update.content[*] ? (@.type == "diff")') AS d(value)
     WHERE l.run_id = $1 AND l.method = $2 AND NOT l.truncated
     ORDER BY l.seq`,
    [runId, SESSION_UPDATE],
  );
  const cut = await db.query(
    'SELECT 1 FROM run_protocol_log WHERE run_id = $1 AND method = $2 AND truncated LIMIT 1',
    [runId, SESSION_UPDATE],
  );
  const latest = new Map<string, RunEditDiff>();
  for (const row of rows) {
    if (row.path === null || row.new_text === null) continue;
    latest.set(`${row.call ?? ''}\u0000${row.path}`, {
      path: row.path,
      oldText: row.old_text,
      newText: row.new_text,
    });
  }
  return { diffs: [...latest.values()], cut: cut.rowCount === 1 };
}

export async function runCommandLines(
  db: Queryable,
  runId: string,
): Promise<{ command: string; cwd: string | null }[]> {
  const { rows } = await db.query<{ command: string; cwd: string | null }>(
    'SELECT command, cwd FROM run_commands WHERE run_id = $1 ORDER BY started_at, id',
    [runId],
  );
  return rows;
}
