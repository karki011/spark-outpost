import type { Queryable } from '../persistence/db.ts';

export interface OutpostNeeds {
  outpost: boolean;
  outpost_draft: boolean;
}

export interface OutpostSession {
  conversationId: string | null;
  runId: string | null;
}

const ACTS_FOR_CHAT = `(r.parent_run_id IS NULL OR r.role = 'integrator'
  OR (r.role = 'builder' AND r.route->>'pieceKey' IS NULL))`;

export async function chatRunId(db: Queryable, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT COALESCE(r.parent_run_id, r.id) AS id FROM runs r
     WHERE r.id = $1 AND ${ACTS_FOR_CHAT}`,
    [runId],
  );
  return rows[0]?.id ?? null;
}

const NEITHER: OutpostNeeds = { outpost: false, outpost_draft: false };

interface SessionRow {
  member: boolean;
  project: boolean;
}

export async function outpostNeeds(db: Queryable, session: OutpostSession): Promise<OutpostNeeds> {
  if (session.conversationId === null || session.runId === null) return NEITHER;
  const { rows } = await db.query<SessionRow>(
    `SELECT
       EXISTS (SELECT 1 FROM outpost_members m WHERE m.conversation_id = c.id) AS member,
       EXISTS (SELECT 1 FROM conversation_projects p WHERE p.conversation_id = c.id) AS project
     FROM conversations c
     JOIN runs r ON r.conversation_id = c.id
     WHERE c.id = $1 AND r.id = $2 AND ${ACTS_FOR_CHAT}
       AND c.session_type <> 'terminal'`,
    [session.conversationId, session.runId],
  );
  const row = rows[0];
  if (!row) return NEITHER;
  return { outpost: row.member, outpost_draft: row.member || row.project };
}
