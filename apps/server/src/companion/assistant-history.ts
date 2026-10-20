import {
  isTerminalRunStatus,
  type AssistantChatLink,
  type AssistantExchange,
  type AssistantHistory,
  type AssistantHistoryQuery,
  type RunStatus,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { listAssistantTopics } from '../persistence/assistant-topics.ts';
import { chatsReadByRun, mentionedChats, type ToolEventRow } from './assistant-links.ts';
import { assistantConversationId } from './assistant-settings.ts';

const KNOWN_CHATS = 500;

interface AskedRow {
  id: string;
  content: string;
  created_at: Date;
  run_id: string | null;
  status: RunStatus | null;
  answer: string | null;
}

async function askedPage(
  db: Queryable,
  conversationId: string,
  query: AssistantHistoryQuery,
): Promise<AskedRow[]> {
  const { rows } = await db.query<AskedRow>(
    `SELECT m.id, m.content, m.created_at, r.id AS run_id, r.status,
       (SELECT a.content FROM messages a WHERE a.run_id = r.id AND a.role = 'assistant'
        ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS answer
     FROM messages m
     LEFT JOIN LATERAL (
       SELECT id, status FROM runs WHERE user_message_id = m.id AND parent_run_id IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) r ON true
     WHERE m.conversation_id = $1 AND m.role = 'user'
       AND ($2::uuid IS NULL OR (m.created_at, m.id) <
         (SELECT b.created_at, b.id FROM messages b WHERE b.id = $2 AND b.conversation_id = $1))
     ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
    [conversationId, query.before ?? null, query.limit + 1],
  );
  return rows;
}

async function toolEvents(db: Queryable, runIds: readonly string[]): Promise<ToolEventRow[]> {
  if (runIds.length === 0) return [];
  const { rows } = await db.query<ToolEventRow>(
    `SELECT run_id, type, payload FROM run_events
     WHERE run_id = ANY($1::uuid[]) AND type IN ('TOOL_CALL_START', 'TOOL_CALL_ARGS')
     ORDER BY run_id, seq`,
    [runIds],
  );
  return rows;
}

async function chatsById(
  db: Queryable,
  workspaceId: string,
  assistantId: string,
  ids: readonly string[],
): Promise<Map<string, AssistantChatLink>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM conversations
     WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND id <> $3`,
    [workspaceId, ids, assistantId],
  );
  return new Map(rows.map((row) => [row.id, { conversationId: row.id, title: row.title }]));
}

async function knownChats(
  db: Queryable,
  workspaceId: string,
  assistantId: string,
): Promise<AssistantChatLink[]> {
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM conversations
     WHERE workspace_id = $1 AND id <> $2 AND archived_at IS NULL
     ORDER BY updated_at DESC LIMIT $3`,
    [workspaceId, assistantId, KNOWN_CHATS],
  );
  return rows.map((row) => ({ conversationId: row.id, title: row.title }));
}

function statusOf(row: AskedRow): AssistantExchange['status'] {
  if (row.answer?.trim()) return 'answered';
  return row.status && isTerminalRunStatus(row.status) ? 'failed' : 'waiting';
}

export async function listAssistantHistory(
  db: Queryable,
  workspaceId: string,
  query: AssistantHistoryQuery,
): Promise<AssistantHistory> {
  const assistantId = await assistantConversationId(db, workspaceId);
  const until = query.before && assistantId ? await askedAt(db, assistantId, query.before) : null;
  if (!assistantId || (query.before && !until)) return { exchanges: [], topics: [], older: null };
  const rows = await askedPage(db, assistantId, query);
  const page = rows.slice(0, query.limit).reverse();
  const runIds = page.flatMap((row) => (row.run_id ? [row.run_id] : []));
  const [readByRun, known] = await Promise.all([
    toolEvents(db, runIds).then(chatsReadByRun),
    knownChats(db, workspaceId, assistantId),
  ]);
  const read = await chatsById(db, workspaceId, assistantId, [
    ...new Set([...readByRun.values()].flat()),
  ]);
  const exchanges = page.map((row): AssistantExchange => {
    const answer = row.answer?.trim() || null;
    const sources = (readByRun.get(row.run_id ?? '') ?? []).flatMap((id) => read.get(id) ?? []);
    return {
      id: row.id,
      question: row.content,
      askedAt: row.created_at.toISOString(),
      runId: row.run_id,
      status: statusOf(row),
      answer,
      source: sources.length === 1 ? sources[0]! : null,
      links: answer ? mentionedChats(answer, known) : [],
    };
  });
  const more = rows.length > query.limit;
  const oldest = page[0];
  const topics = await listAssistantTopics(db, workspaceId, {
    from: more && oldest ? oldest.created_at : null,
    until,
  });
  return { exchanges, topics, older: more && oldest ? oldest.id : null };
}

async function askedAt(db: Queryable, conversationId: string, id: string): Promise<Date | null> {
  const { rows } = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM messages WHERE id = $1 AND conversation_id = $2',
    [id, conversationId],
  );
  return rows[0]?.created_at ?? null;
}
