import type { AskSparkAction } from '@spark-outpost/contracts';
import { addIslandRequest } from '../../companion/island-requests.ts';
import { OutpostError } from '../../persistence/outposts.ts';
import { postToOutpost } from '../../outposts/post-service.ts';
import { getApproval } from '../../persistence/approvals.ts';
import { markConversationSeen } from '../../persistence/conversation-actions.ts';
import type { Queryable } from '../../persistence/db.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { ASK_SPARK_REFUSALS, assistantChatOf } from './ask-spark-limits.ts';
import type { Performed } from './performed.ts';

const SET_ASIDE_REQUEST_MS = 10 * 60_000;

export const INBOX_REFUSALS = {
  notFinished: 'That chat has no finished turn to clear.',
  notWaiting: ASK_SPARK_REFUSALS.notWaiting,
  noOutpost: 'That outpost no longer exists.',
} as const;

export async function finishedChat(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ title: string; status: string | null }>(
    `SELECT c.title, (SELECT r.status FROM runs r
             WHERE r.conversation_id = c.id AND r.parent_run_id IS NULL
             ORDER BY r.created_at DESC LIMIT 1) AS status
     FROM conversations c
     WHERE c.id = $1 AND c.workspace_id = $2 AND c.archived_at IS NULL`,
    [conversationId, workspaceId],
  );
  const row = rows[0];
  return row?.status === 'succeeded' || row?.status === 'failed' ? row.title : null;
}

export async function waitingCard(
  db: Queryable,
  workspaceId: string,
  approvalId: string,
): Promise<{ id: string; title: string; chatTitle: string }> {
  const approval = await getApproval(db, approvalId);
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT c.id, c.title FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $1 AND c.workspace_id = $2`,
    [approval?.runId ?? null, workspaceId],
  );
  const chat = rows[0];
  if (!approval || !chat || approval.status !== 'pending') {
    throw new SparkToolError(INBOX_REFUSALS.notWaiting);
  }
  if (chat.id === (await assistantChatOf(db, workspaceId))) {
    throw new SparkToolError(ASK_SPARK_REFUSALS.ownCard);
  }
  return { id: approval.id, title: approval.title, chatTitle: chat.title };
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new SparkToolError(`This action is missing its ${what}.`);
  return value;
}

async function clearFinished(context: SparkToolContext, action: AskSparkAction) {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const chatId = required(action.conversationId, 'chat');
  const title = await finishedChat(db, workspaceId, chatId);
  if (title === null) throw new SparkToolError(INBOX_REFUSALS.notFinished);
  await markConversationSeen(db, workspaceId, chatId);
  return { message: `Cleared “${title}” from Finished.`, chatId };
}

async function setAside(context: SparkToolContext, action: AskSparkAction) {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const card = await waitingCard(db, workspaceId, required(action.approvalId, 'card'));
  await addIslandRequest(db, workspaceId, {
    kind: 'set_aside',
    target: card.id,
    expiresAt: new Date(Date.now() + SET_ASIDE_REQUEST_MS),
  });
  return `Set aside “${card.title}” in “${card.chatTitle}” for later.`;
}

async function postOutpost(context: SparkToolContext, action: AskSparkAction) {
  const { deps, scope } = context;
  const outpostId = required(action.outpostId, 'outpost');
  const posts = await postToOutpost(
    { db: deps.db, workspaceId: scope.workspaceId },
    {
      outpostId,
      author: { kind: 'assistant', runId: required(scope.runId, 'run') },
      text: required(action.text, 'message'),
    },
  ).catch((error: unknown) => {
    if (error instanceof OutpostError) throw new SparkToolError(error.message);
    throw error;
  });
  const [post] = posts;
  return post?.kind === 'request' ? `Posted a request to @${post.toHandle}.` : 'Posted a note.';
}

export async function performInbox(
  context: SparkToolContext,
  action: AskSparkAction,
): Promise<Performed> {
  switch (action.op) {
    case 'clear_finished': {
      const { message, chatId } = await clearFinished(context, action);
      return { message, url: null, output: { conversationId: chatId } };
    }
    case 'set_aside':
      return { message: await setAside(context, action), url: null, output: {} };
    default:
      return { message: await postOutpost(context, action), url: null, output: {} };
  }
}
