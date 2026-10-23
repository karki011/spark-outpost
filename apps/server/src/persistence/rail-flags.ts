import {
  providerLabel,
  railFlagSchema,
  railFlagTitle,
  sentOutTitle,
  type RailFlag,
  type RailFlagDecision,
  type RailKind,
  type RailOriginal,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewRailFlag {
  toolCallId: string | null;
  rail: RailKind;
  paths: string[];
  inside: boolean;
  originals: RailOriginal[];
  read?: readonly string[];
  stopped?: boolean;
}

interface RailFlagRow {
  id: string;
  run_id: string;
  turn_run_id: string;
  rail: string;
  title: string;
  paths: unknown;
  inside: boolean;
  originals: unknown;
  status: string;
  created_at: Date;
}

const COLUMNS = `f.id, f.run_id, COALESCE(r.parent_run_id, f.run_id) AS turn_run_id, f.rail,
  f.title, f.paths, f.inside, f.originals, f.status, f.created_at`;

function toFlag(row: RailFlagRow): RailFlag {
  return railFlagSchema.parse({
    id: row.id,
    runId: row.run_id,
    turnRunId: row.turn_run_id,
    rail: row.rail,
    title: row.title,
    paths: row.paths,
    inside: row.inside,
    originals: row.originals,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  });
}

export class RailFlagNotFoundError extends Error {
  constructor() {
    super('That flag was not found.');
  }
}

export async function flagAgentName(db: Queryable, runId: string): Promise<string> {
  const { rows } = await db.query<{ name: string | null; provider: string | null }>(
    `SELECT route->>'name' AS name, provider FROM runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.name ?? providerLabel(rows[0]?.provider ?? '');
}

function titleOf(agent: string, flag: NewRailFlag): string {
  if (flag.rail !== 'sent_out') return railFlagTitle(agent, flag.rail, flag.paths);
  return sentOutTitle(agent, flag.paths[0] ?? 'out', flag.read ?? []);
}

export async function insertRailFlag(
  db: Queryable,
  runId: string,
  agent: string,
  flag: NewRailFlag,
): Promise<RailFlag | null> {
  const { rows } = await db.query<RailFlagRow>(
    `WITH inserted AS (
       INSERT INTO rail_flags (id, run_id, conversation_id, tool_call_id, rail, title, paths,
         inside, originals)
       SELECT $1, r.id, r.conversation_id, $3, $4, $5, $6::jsonb, $7, $8::jsonb
       FROM runs r
       WHERE r.id = $2 AND NOT EXISTS (
         SELECT 1 FROM rail_flags f JOIN runs flagged ON flagged.id = f.run_id
         WHERE f.rail = $4 AND f.paths = $6::jsonb AND (
           f.run_id = r.id OR ($4 = 'sent_out'
             AND COALESCE(flagged.parent_run_id, flagged.id) = COALESCE(r.parent_run_id, r.id))
         )
       )
       RETURNING *
     )
     SELECT ${COLUMNS} FROM inserted f JOIN runs r ON r.id = f.run_id`,
    [
      newId(),
      runId,
      flag.toolCallId,
      flag.rail,
      titleOf(agent, flag),
      JSON.stringify(flag.paths),
      flag.inside,
      JSON.stringify(flag.originals),
    ],
  );
  return rows[0] ? toFlag(rows[0]) : null;
}

export async function listRailFlags(db: Queryable, conversationId: string): Promise<RailFlag[]> {
  const { rows } = await db.query<RailFlagRow>(
    `SELECT ${COLUMNS} FROM rail_flags f JOIN runs r ON r.id = f.run_id
     WHERE f.conversation_id = $1 ORDER BY f.created_at, f.id`,
    [conversationId],
  );
  return rows.map(toFlag);
}

export async function getRailFlag(
  db: Queryable,
  workspaceId: string,
  flagId: string,
): Promise<RailFlag> {
  const { rows } = await db.query<RailFlagRow>(
    `SELECT ${COLUMNS} FROM rail_flags f JOIN runs r ON r.id = f.run_id
     JOIN conversations c ON c.id = f.conversation_id
     WHERE f.id = $1 AND c.workspace_id = $2`,
    [flagId, workspaceId],
  );
  if (!rows[0]) throw new RailFlagNotFoundError();
  return toFlag(rows[0]);
}

export async function settleRailFlag(
  db: Queryable,
  flagId: string,
  action: RailFlagDecision['action'],
): Promise<void> {
  await db.query(
    `UPDATE rail_flags SET status = $2, decided_at = now() WHERE id = $1 AND status = 'open'`,
    [flagId, action === 'revert' ? 'reverted' : 'dismissed'],
  );
}

export async function revertTargetRun(db: Queryable, runId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM runs r JOIN runs flagged ON flagged.id = $1
     WHERE r.id IN (flagged.id, flagged.parent_run_id) AND r.snapshot_kind IS NOT NULL
     ORDER BY r.id = flagged.id DESC LIMIT 1`,
    [runId],
  );
  return rows[0]?.id ?? runId;
}
