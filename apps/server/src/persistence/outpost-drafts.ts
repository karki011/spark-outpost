import { outpostDraftSchema } from '@spark-outpost/contracts';
import type { DraftStore, StoredDraft } from '../outposts/ports.ts';

interface DraftRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  run_id: string | null;
  outpost_id: string | null;
  title: string;
  body: unknown;
  started_at: Date | null;
  reported_at: Date | null;
  created_at: Date;
}

const DRAFT_COLUMNS = `id, workspace_id, conversation_id, run_id, outpost_id, title, body,
  started_at, reported_at, created_at`;

function toDraft(row: DraftRow): StoredDraft | null {
  const body = outpostDraftSchema.safeParse(row.body);
  if (!body.success) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    outpostId: row.outpost_id,
    title: row.title,
    body: body.data,
    startedAt: row.started_at?.toISOString() ?? null,
    reportedAt: row.reported_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export const getDraft: DraftStore['getDraft'] = async (db, workspaceId, id) => {
  const { rows } = await db.query<DraftRow>(
    `SELECT ${DRAFT_COLUMNS} FROM outpost_drafts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
  return rows[0] ? toDraft(rows[0]) : null;
};

export const draftsOfChat: DraftStore['draftsOfChat'] = async (db, workspaceId, conversationId) => {
  const { rows } = await db.query<DraftRow>(
    `SELECT ${DRAFT_COLUMNS} FROM outpost_drafts
     WHERE workspace_id = $1 AND conversation_id = $2 ORDER BY created_at, id`,
    [workspaceId, conversationId],
  );
  return rows.flatMap((row) => toDraft(row) ?? []);
};

export const saveDraft: DraftStore['saveDraft'] = async (db, draft) => {
  await db.query(
    `INSERT INTO outpost_drafts (id, workspace_id, conversation_id, run_id, outpost_id, title, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      draft.id,
      draft.workspaceId,
      draft.conversationId,
      draft.runId,
      draft.outpostId,
      draft.body.title,
      JSON.stringify(draft.body),
    ],
  );
  const saved = await getDraft(db, draft.workspaceId, draft.id);
  if (!saved) throw new Error(`Outpost draft ${draft.id} was neither saved nor found.`);
  return saved;
};

export const markStarted: DraftStore['markStarted'] = async (db, id, outpostId) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_drafts SET outpost_id = $2, started_at = COALESCE(started_at, now())
     WHERE id = $1 AND (started_at IS NULL OR outpost_id = $2)`,
    [id, outpostId],
  );
  return rowCount === 1;
};

export const releaseStart: DraftStore['releaseStart'] = async (db, id, outpostId, before) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_drafts SET started_at = NULL, outpost_id = $3
     WHERE id = $1 AND outpost_id = $2 AND started_at IS NOT NULL AND reported_at IS NULL`,
    [id, outpostId, before],
  );
  return rowCount === 1;
};

export const markReported: DraftStore['markReported'] = async (db, id) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_drafts SET reported_at = now()
     WHERE id = $1 AND started_at IS NOT NULL AND reported_at IS NULL`,
    [id],
  );
  return rowCount === 1;
};
