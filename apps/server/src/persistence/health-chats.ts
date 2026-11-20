import type { ConversationSummary } from '@spark-outpost/contracts';
import { withChatBranches } from './chat-worktrees.ts';
import { LISTED_CHAT } from './conversation-search.ts';
import type { Queryable } from './db.ts';
import { withNativeTerminals } from './native-terminals.ts';
import { toConversationSummary, type ConversationSummaryRow } from './rows.ts';
import { summaryQuery } from './summary-query.ts';

const HEALTH_CHAT = `c.archived_at IS NULL AND (
    (c.session_type <> 'terminal' AND r.status = 'failed' AND r.error IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM native_terminal_sessions t
      WHERE t.conversation_id = c.id AND t.state NOT IN ('exited', 'error', 'interrupted')
    )
  )`;

export async function listHealthConversations(
  db: Queryable,
  workspaceId: string,
): Promise<ConversationSummary[]> {
  const { rows } = await db.query<ConversationSummaryRow>(
    `${summaryQuery} WHERE ${LISTED_CHAT} AND ${HEALTH_CHAT}
     ORDER BY c.updated_at DESC, c.id DESC`,
    [workspaceId],
  );
  return withChatBranches(db, await withNativeTerminals(db, rows.map(toConversationSummary)));
}
