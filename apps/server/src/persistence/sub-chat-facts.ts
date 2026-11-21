import {
  runStatusSchema,
  subChatPullStateSchema,
  subChatStatus,
  type ConversationSummary,
} from '@spark-outpost/contracts';

export const SUB_CHAT_COLUMNS = `sc.position AS sub_chat_position,
    sc.parent_conversation_id AS sub_chat_parent_id,
    COALESCE(pc.title, sc.parent_title) AS sub_chat_parent_title,
    sc.started_at IS NOT NULL AS sub_chat_started,
    CASE WHEN sc.conversation_id IS NOT NULL THEN (
      EXISTS (SELECT 1 FROM chat_queue waiting WHERE waiting.conversation_id = c.id)
      OR EXISTS (
        SELECT 1 FROM chat_asks ask
        WHERE ask.to_conversation_id = c.id AND ask.delivered_as IS NULL
      )
    ) END AS sub_chat_task_queued,
    CASE WHEN sc.conversation_id IS NOT NULL THEN (
      SELECT CASE WHEN bool_or(pull.pr_state = 'open') THEN 'open'
        WHEN bool_or(pull.pr_state = 'merged') THEN 'merged'
        WHEN count(*) > 0 THEN 'closed' END
      FROM pr_watches pull WHERE pull.conversation_id = c.id
    ) END AS sub_chat_pull_state,
    CASE WHEN sc.conversation_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM task_outcomes kept_outcome
      JOIN runs kept_run ON kept_run.id = kept_outcome.run_id
      WHERE kept_run.conversation_id = c.id AND kept_outcome.kept->'files'->0 IS NOT NULL
    ) END AS sub_chat_kept_changes,
    (SELECT count(*)::int FROM sub_chats piece
     WHERE piece.parent_conversation_id = c.id) AS sub_chat_count`;

export const SUB_CHAT_JOINS = `LEFT JOIN sub_chats sc ON sc.conversation_id = c.id
  LEFT JOIN conversations pc ON pc.id = sc.parent_conversation_id`;

export interface SubChatSummaryRow {
  sub_chat_position?: number | null;
  sub_chat_parent_id?: string | null;
  sub_chat_parent_title?: string | null;
  sub_chat_started?: boolean | null;
  sub_chat_task_queued?: boolean | null;
  sub_chat_pull_state?: string | null;
  sub_chat_kept_changes?: boolean | null;
  sub_chat_count?: number | null;
}

interface ChatState {
  archived: boolean;
  needsInput: boolean;
  runStatus: string | null;
}

type SubChatFields = Pick<
  ConversationSummary,
  'parent' | 'formerParent' | 'subChat' | 'subChatCount'
>;

function parentOf(row: SubChatSummaryRow): Pick<SubChatFields, 'parent' | 'formerParent'> {
  const title = row.sub_chat_parent_title ?? '';
  if (row.sub_chat_parent_id) return { parent: { id: row.sub_chat_parent_id, title } };
  return { formerParent: { title } };
}

export function subChatFields(row: SubChatSummaryRow, chat: ChatState): SubChatFields {
  const count = row.sub_chat_count ? { subChatCount: row.sub_chat_count } : {};
  if (row.sub_chat_position === null || row.sub_chat_position === undefined) return count;
  const status = subChatStatus({
    started: row.sub_chat_started === true,
    archived: chat.archived,
    needsInput: chat.needsInput,
    runStatus: runStatusSchema.safeParse(chat.runStatus).data ?? null,
    taskQueued: row.sub_chat_task_queued === true,
    pullRequest: subChatPullStateSchema.safeParse(row.sub_chat_pull_state).data ?? null,
    keptChanges: row.sub_chat_kept_changes === true,
  });
  return { ...count, ...parentOf(row), subChat: { position: row.sub_chat_position, status } };
}
