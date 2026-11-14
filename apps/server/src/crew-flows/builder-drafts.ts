import { SPARK_ACTION_KIND, type CrewDraft } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

interface DraftRow {
  id: string;
  conversation_id: string;
  action: unknown;
  in_builder: boolean;
}

function draftOf(row: DraftRow): CrewDraft | null {
  const action = row.action as {
    action?: string;
    target?: string;
    name?: unknown;
    files?: { change?: string }[];
  } | null;
  const name = typeof action?.name === 'string' ? action.name : '';
  const base = { approvalId: row.id, conversationId: row.conversation_id, name };
  if (action?.action === 'create_teammate') {
    return { ...base, target: 'spark', inBuilder: row.in_builder };
  }
  const files = action?.files ?? [];
  const newWorkflow =
    action?.action === 'crew_edit' &&
    action.target === 'workflow' &&
    files.length > 0 &&
    files.every((file) => file.change === 'new');
  return newWorkflow ? { ...base, target: 'workflow', inBuilder: row.in_builder } : null;
}

export async function crewDrafts(db: Queryable, workspaceId: string): Promise<CrewDraft[]> {
  const { rows } = await db.query<DraftRow>(
    `SELECT a.id, r.conversation_id, a.payload->'sparkAction' AS action,
            EXISTS (
              SELECT 1 FROM crew_builder_chats b
              WHERE b.conversation_id = r.conversation_id AND b.removed_at IS NULL
            ) AS in_builder
     FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND c.archived_at IS NULL AND a.status = 'pending'
       AND a.kind = $2
       AND a.payload->'sparkAction'->>'action' IN ('create_teammate', 'crew_edit')
     ORDER BY a.created_at`,
    [workspaceId, SPARK_ACTION_KIND],
  );
  return rows.map(draftOf).filter((draft): draft is CrewDraft => draft !== null);
}
