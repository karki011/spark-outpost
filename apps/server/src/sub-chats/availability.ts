import type { Queryable } from '../persistence/db.ts';

export interface ChatSession {
  conversationId: string | null;
  runId: string | null;
}

export async function chatMessagesNeed(db: Queryable, session: ChatSession): Promise<boolean> {
  if (session.conversationId === null || session.runId === null) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $2 AND c.id = $1 AND r.parent_run_id IS NULL
       AND r.source IS DISTINCT FROM 'voice' AND c.kind = 'chat'
       AND c.session_type <> 'terminal'`,
    [session.conversationId, session.runId],
  );
  return rowCount === 1;
}
