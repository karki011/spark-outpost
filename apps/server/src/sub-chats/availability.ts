import type { Queryable } from '../persistence/db.ts';
import { coordinatesOwnSubChats, turnStart } from './asks.ts';

export interface ChatSession {
  conversationId: string | null;
  runId: string | null;
}

export interface SubChatNeeds {
  sub_chats: boolean;
  sub_chat_stop: boolean;
}

const NEITHER: SubChatNeeds = { sub_chats: false, sub_chat_stop: false };

const OWN_TURN = `FROM runs r JOIN conversations c ON c.id = r.conversation_id
  WHERE r.id = $2 AND c.id = $1 AND r.parent_run_id IS NULL
    AND r.source IS DISTINCT FROM 'voice' AND r.source IS DISTINCT FROM 'workflow'
    AND c.kind = 'chat'
    AND c.session_type <> 'terminal'`;

export async function chatMessagesNeed(db: Queryable, session: ChatSession): Promise<boolean> {
  if (session.conversationId === null || session.runId === null) return false;
  const { rowCount } = await db.query(`SELECT 1 ${OWN_TURN}`, [
    session.conversationId,
    session.runId,
  ]);
  return rowCount === 1;
}

export async function splitsIntoSubChats(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM conversations c
     WHERE c.id = $1 AND c.kind = 'chat' AND c.session_type <> 'terminal'
       AND EXISTS (SELECT 1 FROM conversation_projects p WHERE p.conversation_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM sub_chats s WHERE s.conversation_id = c.id)`,
    [conversationId],
  );
  return rowCount === 1;
}

export async function subChatNeeds(db: Queryable, session: ChatSession): Promise<SubChatNeeds> {
  if (session.conversationId === null || session.runId === null) return NEITHER;
  const { rows } = await db.query<{ project: boolean; sub_chat: boolean; parent: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM conversation_projects p WHERE p.conversation_id = c.id) AS project,
       EXISTS (SELECT 1 FROM sub_chats s WHERE s.conversation_id = c.id) AS sub_chat,
       EXISTS (SELECT 1 FROM sub_chats s WHERE s.parent_conversation_id = c.id) AS parent
     ${OWN_TURN}`,
    [session.conversationId, session.runId],
  );
  const row = rows[0];
  if (!row) return NEITHER;
  const startedBy = await turnStart(db, session.runId);
  return {
    sub_chats: row.project && !row.sub_chat && startedBy === null,
    sub_chat_stop: row.parent && (startedBy === null || coordinatesOwnSubChats(startedBy)),
  };
}
