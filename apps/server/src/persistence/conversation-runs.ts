import type { ConversationRuns } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { promptCacheFor } from './prompt-cache.ts';
import { RUN_FROM_CHAT_COLUMN, toRun, type RunRow } from './rows.ts';
import { conversationUsage } from './usage.ts';

export async function getConversationRuns(
  db: Queryable,
  conversationId: string,
): Promise<ConversationRuns> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.*, ${RUN_FROM_CHAT_COLUMN} FROM runs r
     WHERE r.conversation_id = $1 ORDER BY r.created_at`,
    [conversationId],
  );
  const promptCache = await promptCacheFor(db, conversationId);
  const runs = rows.map(toRun);
  return {
    runs: runs.filter((run) => !run.parentRunId),
    usageTotals: conversationUsage(runs),
    ...(promptCache.last ? { promptCache } : {}),
  };
}
