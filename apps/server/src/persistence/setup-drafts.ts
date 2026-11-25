import {
  setupTargetSchema,
  type SetupDraft,
  type SetupFields,
  type SetupTarget,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface DraftRow {
  target: string;
  fields: SetupFields;
  conversation_id: string | null;
  created_at: Date;
}

export interface NewSetupDraft {
  workspaceId: string;
  target: SetupTarget;
  fields: SetupFields;
  conversationId: string | null;
}

export async function saveSetupDraft(db: Queryable, draft: NewSetupDraft): Promise<void> {
  await db.query(
    `INSERT INTO setup_drafts (workspace_id, target, fields, conversation_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, target) DO UPDATE
       SET fields = EXCLUDED.fields, conversation_id = EXCLUDED.conversation_id, created_at = now()`,
    [draft.workspaceId, draft.target, JSON.stringify(draft.fields), draft.conversationId],
  );
}

export async function listSetupDrafts(db: Queryable, workspaceId: string): Promise<SetupDraft[]> {
  const { rows } = await db.query<DraftRow>(
    `SELECT target, fields, conversation_id, created_at FROM setup_drafts
     WHERE workspace_id = $1 ORDER BY created_at`,
    [workspaceId],
  );
  return rows.flatMap((row) => {
    const target = setupTargetSchema.safeParse(row.target);
    if (!target.success) return [];
    return [
      {
        target: target.data,
        fields: row.fields,
        conversationId: row.conversation_id,
        createdAt: row.created_at.toISOString(),
      },
    ];
  });
}

export async function deleteSetupDraft(
  db: Queryable,
  workspaceId: string,
  target: SetupTarget,
): Promise<void> {
  await db.query('DELETE FROM setup_drafts WHERE workspace_id = $1 AND target = $2', [
    workspaceId,
    target,
  ]);
}
