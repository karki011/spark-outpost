import type { Queryable } from '../persistence/db.ts';
import { runFromDevice } from '../remote/run-mark.ts';

export interface MacScope {
  conversationId: string | null;
  runId: string | null;
  readOnly?: boolean;
  assistant?: boolean;
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

export type MacRefusedRun = 'off' | 'remote' | 'child' | 'voice' | 'read_only' | 'no_chat';

export async function spokenRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ spoken: boolean }>(
    `SELECT COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
       = 'voice' AS spoken FROM runs r WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.spoken === true;
}

export async function macRunRefusal(db: Queryable, scope: MacScope): Promise<MacRefusedRun | null> {
  if (scope.readOnly && !scope.assistant) return 'read_only';
  if (!scope.conversationId) return 'no_chat';
  const runRefusal = scope.runId ? await refusedRun(db, scope.runId) : null;
  if (runRefusal) return runRefusal;
  if (!(await switchedOn(db, scope.conversationId))) return 'off';
  return null;
}

async function refusedRun(db: Queryable, runId: string): Promise<MacRefusedRun | null> {
  if (await runFromDevice(db, runId)) return 'remote';
  if (await childRun(db, runId)) return 'child';
  if (await spokenRun(db, runId)) return 'voice';
  return null;
}
