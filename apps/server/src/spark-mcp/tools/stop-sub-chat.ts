import { parseChatReference, type StopSubChatAction } from '@spark-outpost/contracts';
import { NOT_THIS_CHATS_SUB_CHAT } from '../../sub-chats/start.ts';
import { deviceRefusal } from '../actions/ask-spark-limits.ts';
import { actionRun, auditAction, proposeAction } from '../actions/confirm.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';

export const STOP_ONLY_OWN_SUB_CHATS = `${NOT_THIS_CHATS_SUB_CHAT} A chat can stop only its own sub-chats.`;

const NO_CHAT = 'Pass the sub-chat’s id or chat link from spark_chats.';

async function ownSubChat(context: SparkToolContext, parentId: string, subChatId: string) {
  const { rows } = await context.deps.db.query<{ title: string; parent_title: string }>(
    `SELECT c.title, parent.title AS parent_title
     FROM sub_chats s
     JOIN conversations c ON c.id = s.conversation_id
     JOIN conversations parent ON parent.id = s.parent_conversation_id
     WHERE s.conversation_id = $1 AND s.parent_conversation_id = $2 AND c.workspace_id = $3`,
    [subChatId, parentId, context.scope.workspaceId],
  );
  return rows[0] ?? null;
}

export async function stopSubChat(context: SparkToolContext, reference: string | undefined) {
  const { conversationId, workspaceId } = context.scope;
  const subChatId = reference ? parseChatReference(reference) : null;
  if (!conversationId || !subChatId) throw new SparkToolError(NO_CHAT);
  const found = await ownSubChat(context, conversationId, subChatId);
  if (!found) throw new SparkToolError(STOP_ONLY_OWN_SUB_CHATS);
  const action: StopSubChatAction = {
    action: 'stop_sub_chat',
    parent: { id: conversationId, title: found.parent_title },
    subChat: { id: subChatId, title: found.title },
  };
  const run = actionRun(context.scope);
  const refusal = await deviceRefusal(context.deps.db, workspaceId, run.runId, action);
  if (refusal) {
    auditAction(run, action, { outcome: 'refused', reason: refusal });
    throw new SparkToolError(refusal);
  }
  return proposeAction(context, action, { sendsTo: null });
}
