import type { Queryable } from '../persistence/db.ts';
import { runFromDevice } from '../remote/run-mark.ts';

export interface MacScope {
  conversationId: string | null;
  runId: string | null;
  readOnly?: boolean;
}

async function switchedOn(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ on: boolean }>(
    `SELECT p.mac_control AS on FROM conversations c
      JOIN profiles p ON p.workspace_id = c.workspace_id WHERE c.id = $1`,
    [conversationId],
  );
  return rows[0]?.on === true;
}

export async function childRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ child: boolean }>(
    'SELECT parent_run_id IS NOT NULL AS child FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.child === true;
}

export type MacRefusedRun = 'off' | 'remote' | 'child' | 'read_only' | 'no_chat';

export async function macRunRefusal(db: Queryable, scope: MacScope): Promise<MacRefusedRun | null> {
  if (scope.readOnly) return 'read_only';
  if (!scope.conversationId) return 'no_chat';
  if (!(await switchedOn(db, scope.conversationId))) return 'off';
  if (!scope.runId) return null;
  if (await runFromDevice(db, scope.runId)) return 'remote';
  if (await childRun(db, scope.runId)) return 'child';
  return null;
}
