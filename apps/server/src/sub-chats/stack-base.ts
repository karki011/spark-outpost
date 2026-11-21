import type { SubChatPullState } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export interface StackParent {
  parentChatId: string;
  owner: string;
  branch: string | null;
}

export function stackOwner(title: string): string {
  return `“${title}”`;
}

interface ParentRow {
  parent_chat: string;
  title: string;
  branch: string | null;
  owns_branch: boolean;
  pr_state: SubChatPullState | null;
}

const PRIMARY_PROJECT = `SELECT cp.project_id FROM conversation_projects cp
  WHERE cp.conversation_id = chat.id ORDER BY cp.position, cp.created_at LIMIT 1`;

function liveBranch(row: ParentRow): string | null {
  const ended = row.pr_state !== null && row.pr_state !== 'open';
  return row.owns_branch && !ended ? row.branch : null;
}

export async function stackParentOf(db: Queryable, chatId: string): Promise<StackParent | null> {
  const { rows } = await db.query<ParentRow>(
    `SELECT parent.id AS parent_chat, parent.title, w.branch,
       COALESCE(w.owns_branch, false) AS owns_branch, pr.pr_state
     FROM sub_chats s
     JOIN conversations parent ON parent.id = s.stacked_on
     JOIN LATERAL (
       SELECT (${PRIMARY_PROJECT}) AS project_id FROM conversations chat
       WHERE chat.id = s.conversation_id
     ) own ON true
     JOIN LATERAL (
       SELECT (${PRIMARY_PROJECT}) AS project_id FROM conversations chat WHERE chat.id = parent.id
     ) theirs ON theirs.project_id = own.project_id
     LEFT JOIN LATERAL (
       SELECT tree.branch, tree.owns_branch FROM chat_worktrees tree
       WHERE tree.conversation_id = parent.id AND tree.project_id = own.project_id
         AND tree.removed_at IS NULL
       ORDER BY tree.created_at LIMIT 1
     ) w ON true
     LEFT JOIN LATERAL (
       SELECT pull.pr_state FROM pr_watches pull
       WHERE pull.conversation_id = parent.id
       ORDER BY (pull.branch = w.branch) DESC NULLS LAST, pull.created_at DESC LIMIT 1
     ) pr ON true
     WHERE s.conversation_id = $1`,
    [chatId],
  );
  const row = rows[0];
  if (!row) return null;
  return { parentChatId: row.parent_chat, owner: stackOwner(row.title), branch: liveBranch(row) };
}
