import type { Compaction, CompactionMethod, Continuation } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewCompaction {
  conversationId: string;
  runId: string | null;
  sessionRowId: string | null;
  agentKey: string | null;
  method: CompactionMethod;
  tokensBefore: number | null;
  tokensAfter: number | null;
  contextSize: number | null;
  summary: string | null;
  lastMessageId: string | null;
  fromConversationId?: string | null;
  fromRunId?: string | null;
}

export async function insertCompaction(db: Queryable, compaction: NewCompaction): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO compactions (id, conversation_id, run_id, session_row_id, agent_key, method,
       tokens_before, tokens_after, context_size, summary, last_message_id, from_conversation_id,
       from_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      compaction.conversationId,
      compaction.runId,
      compaction.sessionRowId,
      compaction.agentKey,
      compaction.method,
      compaction.tokensBefore,
      compaction.tokensAfter,
      compaction.contextSize,
      compaction.summary,
      compaction.lastMessageId,
      compaction.fromConversationId ?? null,
      compaction.fromRunId ?? null,
    ],
  );
  return id;
}

interface CompactionRow {
  id: string;
  run_id: string | null;
  method: CompactionMethod;
  tokens_before: number | null;
  tokens_after: number | null;
  context_size: number | null;
  summary: string | null;
  from_conversation_id: string | null;
  from_title: string | null;
  created_at: Date;
}

function toCompaction(row: CompactionRow): Compaction {
  return {
    id: row.id,
    runId: row.run_id,
    method: row.method,
    tokensBefore: row.tokens_before,
    tokensAfter: row.tokens_after,
    contextSize: row.context_size,
    summary: row.summary,
    fromConversationId: row.from_conversation_id,
    fromTitle: row.from_title,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listCompactions(
  db: Queryable,
  conversationId: string,
): Promise<Compaction[]> {
  const { rows } = await db.query<CompactionRow>(
    `SELECT k.id, k.run_id, k.method, k.tokens_before, k.tokens_after, k.context_size, k.summary,
            k.from_conversation_id, f.title AS from_title, k.created_at
     FROM compactions k
     LEFT JOIN conversations f ON f.id = k.from_conversation_id
     WHERE k.conversation_id = $1
     ORDER BY k.created_at, k.id`,
    [conversationId],
  );
  return rows.map(toCompaction);
}

export async function listContinuations(
  db: Queryable,
  conversationId: string,
): Promise<Continuation[]> {
  const { rows } = await db.query<{ id: string; title: string; from_run_id: string | null }>(
    `SELECT c.id, c.title, k.from_run_id FROM compactions k
     JOIN conversations c ON c.id = k.conversation_id
     WHERE k.from_conversation_id = $1
     ORDER BY k.created_at, k.id`,
    [conversationId],
  );
  return rows.map((row) => ({ conversationId: row.id, title: row.title, runId: row.from_run_id }));
}

export interface SparkSeed {
  summary: string;
  lastMessageId: string | null;
}

export async function latestSparkSeed(
  db: Queryable,
  conversationId: string,
): Promise<SparkSeed | null> {
  const { rows } = await db.query<{ summary: string; last_message_id: string | null }>(
    `SELECT summary, last_message_id FROM compactions
     WHERE conversation_id = $1 AND method = 'spark' AND summary IS NOT NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [conversationId],
  );
  const row = rows[0];
  return row ? { summary: row.summary, lastMessageId: row.last_message_id } : null;
}

export async function settleTokensAfter(
  db: Queryable,
  runId: string,
  tokensAfter: number,
): Promise<void> {
  await db.query(
    `UPDATE compactions SET tokens_after = $2
     WHERE run_id = $1 AND method IN ('spark', 'agent') AND tokens_after IS NULL`,
    [runId, tokensAfter],
  );
}

export async function pendingCardInChat(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.status = 'pending' LIMIT 1`,
    [conversationId],
  );
  return (rowCount ?? 0) > 0;
}
