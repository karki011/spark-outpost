import { subChatProgress, type PlanPiece } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface PlanRow extends PlanPiece {
  parentId: string;
  workspaceId: string;
  stackedOn: string | null;
  wrappedUp: boolean;
}

interface PlanDbRow {
  conversation_id: string;
  parent_conversation_id: string;
  workspace_id: string;
  title: string;
  stacked_on: string | null;
  starts_after: string[];
  started: boolean;
  archived: boolean;
  wrapped_up: boolean;
  waiting: boolean;
  reported: boolean;
}

const SELECT_PLAN = `SELECT s.conversation_id, s.parent_conversation_id, c.workspace_id, c.title,
    s.stacked_on, s.starts_after, s.started_at IS NOT NULL AS started,
    c.archived_at IS NOT NULL AS archived, s.wrapped_up_at IS NOT NULL AS wrapped_up,
    EXISTS (
      SELECT 1 FROM chat_asks a
      WHERE a.to_conversation_id = s.conversation_id
        AND a.from_conversation_id = s.parent_conversation_id AND a.state = 'waiting'
    ) AS waiting,
    s.report IS NOT NULL AND s.report->>'reason' IS NULL AS reported
  FROM sub_chats s JOIN conversations c ON c.id = s.conversation_id`;

function toPlanRow(row: PlanDbRow): PlanRow {
  const waitsFor = new Set([...(row.stacked_on ? [row.stacked_on] : []), ...row.starts_after]);
  return {
    id: row.conversation_id,
    title: row.title,
    progress: subChatProgress(row),
    waitsFor: [...waitsFor],
    parentId: row.parent_conversation_id,
    workspaceId: row.workspace_id,
    stackedOn: row.stacked_on,
    wrappedUp: row.wrapped_up,
  };
}

export async function planOf(db: Queryable, parentConversationId: string): Promise<PlanRow[]> {
  const { rows } = await db.query<PlanDbRow>(
    `${SELECT_PLAN} WHERE s.parent_conversation_id = $1 ORDER BY s.position, s.created_at`,
    [parentConversationId],
  );
  return rows.map(toPlanRow);
}

export async function openPlans(db: Queryable): Promise<PlanRow[][]> {
  const { rows } = await db.query<PlanDbRow>(
    `${SELECT_PLAN}
     WHERE s.parent_conversation_id IN (
       SELECT open.parent_conversation_id FROM sub_chats open
       WHERE open.parent_conversation_id IS NOT NULL
         AND (open.started_at IS NULL OR open.wrapped_up_at IS NULL)
     )
     ORDER BY s.parent_conversation_id, s.position, s.created_at`,
  );
  const plans = new Map<string, PlanRow[]>();
  for (const row of rows.map(toPlanRow)) {
    const plan = plans.get(row.parentId);
    if (plan) plan.push(row);
    else plans.set(row.parentId, [row]);
  }
  return [...plans.values()];
}
