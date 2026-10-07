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
