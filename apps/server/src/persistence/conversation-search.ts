import type { ConversationSummary, SearchMatch } from '@spark-outpost/contracts';
import { withChatBranches } from './chat-worktrees.ts';
import type { Queryable } from './db.ts';
import { containsPattern } from './like-pattern.ts';
import { withNativeTerminals } from './native-terminals.ts';
import { toConversationSummary, type ConversationSummaryRow } from './rows.ts';
import { matchSnippet, prefixQuery, searchWords } from './search-snippet.ts';
import { summaryQuery } from './summary-query.ts';

export const CHAT_LIST_LIMIT = 500;
const SNIPPET_SOURCE_CHARS = 100_000;

export const LISTED_CHAT = `c.workspace_id = $1 AND c.kind = 'chat'
  AND (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
    OR EXISTS (SELECT 1 FROM native_terminal_sessions t WHERE t.conversation_id = c.id)
    OR EXISTS (SELECT 1 FROM outpost_members om WHERE om.conversation_id = c.id))`;

interface ChatHit {
  conversationId: string;
  match: SearchMatch | null;
}

interface HitRow {
  id: string;
  message_id: string | null;
  run_id: string | null;
  content: string | null;
}

const WORDS_QUERY = `to_tsquery('simple', $2)`;

const WORDS_MATCH = {
  message: `m.search @@ ${WORDS_QUERY}`,
  rank: `ts_rank(m.search, ${WORDS_QUERY})`,
  title: `search_vector(c.title) @@ ${WORDS_QUERY}`,
};

const TEXT_MATCH = {
  message: 'm.content ILIKE $2',
  rank: '0',
  title: 'false',
};

function hitsQuery(match: typeof WORDS_MATCH): string {
  return `
    WITH best AS MATERIALIZED (
      SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.id, m.run_id,
        ${match.rank} AS rank
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id AND c.workspace_id = $1 AND c.kind = 'chat'
      WHERE ${match.message}
      ORDER BY m.conversation_id, rank DESC, m.created_at DESC, m.id
    ), ranked AS (
      SELECT c.id, b.id AS message_id, b.run_id,
        row_number() OVER (
          ORDER BY c.title ILIKE $3 DESC, ${match.title} DESC, COALESCE(b.rank, 0) DESC,
            c.pinned_at DESC NULLS LAST, c.updated_at DESC
        ) AS place
      FROM conversations c
      LEFT JOIN best b ON b.conversation_id = c.id
      WHERE ${LISTED_CHAT}
        AND (b.id IS NOT NULL OR c.title ILIKE $3 OR ${match.title})
      ORDER BY place
      LIMIT ${CHAT_LIST_LIMIT}
    )
    SELECT k.id, k.message_id, left(m.content, ${SNIPPET_SOURCE_CHARS}) AS content,
      COALESCE(k.run_id, (SELECT r.id FROM runs r WHERE r.user_message_id = k.message_id)) AS run_id
    FROM ranked k
    LEFT JOIN messages m ON m.id = k.message_id
    ORDER BY k.place`;
}

function toHit(row: HitRow, text: string): ChatHit {
  if (!row.message_id || row.content === null) return { conversationId: row.id, match: null };
  return {
    conversationId: row.id,
    match: { messageId: row.message_id, runId: row.run_id, parts: matchSnippet(row.content, text) },
  };
}

async function findChatHits(db: Queryable, workspaceId: string, text: string): Promise<ChatHit[]> {
  const words = searchWords(text);
  const pattern = containsPattern(text);
  const { rows } =
    words.length > 0
      ? await db.query<HitRow>(hitsQuery(WORDS_MATCH), [workspaceId, prefixQuery(words), pattern])
      : await db.query<HitRow>(hitsQuery(TEXT_MATCH), [workspaceId, pattern, pattern]);
  return rows.map((row) => toHit(row, text));
}

export async function searchConversations(
  db: Queryable,
  workspaceId: string,
  text: string,
): Promise<ConversationSummary[]> {
  const hits = await findChatHits(db, workspaceId, text);
  if (hits.length === 0) return [];
  const { rows } = await db.query<ConversationSummaryRow>(
    `${summaryQuery} WHERE c.id = ANY($1::uuid[])`,
    [hits.map((hit) => hit.conversationId)],
  );
  const byId = new Map(rows.map((row) => [row.id, toConversationSummary(row)]));
  const ordered = hits.flatMap((hit) => {
    const summary = byId.get(hit.conversationId);
    if (!summary) return [];
    return [hit.match ? { ...summary, match: hit.match } : summary];
  });
  return withChatBranches(db, await withNativeTerminals(db, ordered));
}
