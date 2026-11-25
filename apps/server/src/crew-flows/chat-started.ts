import { chatTurn } from '../persistence/chat-turns.ts';
import type { Queryable } from '../persistence/db.ts';
import { markSeen, queueTrigger, triggersWith } from './trigger-records.ts';

const STARTING_SOURCES: ReadonlySet<string | null> = new Set([
  null,
  'ui',
  'e2e',
  'bench',
  'queue',
  'voice',
  'pages',
  'ticket',
  'slack',
  'assistant',
]);

export interface FirstMessage {
  conversationId: string;
  messageId: string;
  source: string | null;
}

async function startedChatWorkspace(db: Queryable, message: FirstMessage): Promise<string | null> {
  const { rows } = await db.query<{ workspace_id: string }>(
    `SELECT c.workspace_id FROM conversations c
     WHERE c.id = $1 AND c.kind = 'chat' AND c.session_type = 'chat'
       AND NOT EXISTS (
         SELECT 1 FROM profiles pf
         WHERE pf.workspace_id = c.workspace_id AND pf.assistant_conversation_id = c.id)
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = c.id AND m.role = 'user' AND m.id <> $2)
       AND NOT EXISTS (
         SELECT 1 FROM compactions k
         WHERE k.conversation_id = c.id AND k.from_conversation_id IS NOT NULL)`,
    [message.conversationId, message.messageId],
  );
  return rows[0]?.workspace_id ?? null;
}

export async function noteFirstMessage(
  db: Queryable,
  message: FirstMessage,
  now = new Date(),
): Promise<void> {
  if (!STARTING_SOURCES.has(message.source)) return;
  const workspaceId = await startedChatWorkspace(db, message);
  if (!workspaceId) return;
  const { conversationId } = message;
  for (const { workflowId, triggers } of await triggersWith(
    db,
    workspaceId,
    'chat_started',
    conversationId,
  )) {
    if (!(await markSeen(db, workspaceId, workflowId, `chat-started:${conversationId}`))) continue;
    await queueTrigger(
      db,
      workspaceId,
      {
        workflowId,
        conversationId,
        kind: 'chat_started',
        debounceMinutes: triggers.debounceMinutes,
      },
      now,
    );
  }
}

export async function chatTurnActive(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM runs WHERE conversation_id = $1 AND ${chatTurn()}
       AND status IN ('queued', 'running', 'awaiting_approval') LIMIT 1`,
    [conversationId],
  );
  return (rowCount ?? 0) > 0;
}

export async function firstTurnSucceeded(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT r.status FROM messages m
     JOIN runs r ON r.user_message_id = m.id AND r.parent_run_id IS NULL
     WHERE m.conversation_id = $1 AND m.role = 'user'
     ORDER BY m.created_at, m.id LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.status === 'succeeded';
}
