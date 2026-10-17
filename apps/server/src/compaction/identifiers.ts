import { projectSecretValues } from '../audit/secret-values.ts';
import type { Queryable } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { extractAnchors, identifiersText } from './anchors.ts';

const TEXT_ROWS = 3_000;
const TEXT_CHARS = 2_000_000;

async function chatTexts(db: Queryable, conversationId: string, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ text: string }>(
    `WITH current AS (
       SELECT r.created_at AS run_at, m.created_at AS message_at FROM runs r
       JOIN messages m ON m.id = r.user_message_id WHERE r.id = $2
     ), since AS (
       SELECT COALESCE((SELECT pf.assistant_history_from FROM profiles pf
         WHERE pf.assistant_conversation_id = $1), '-infinity'::timestamptz) AS at
     )
     SELECT CASE WHEN read <= $4 THEN text
       ELSE regexp_replace(left(text, ($4 - (read - length(text)))::int), '\\S*$', '')
     END AS text FROM (
     SELECT text, at, seq,
       sum(length(text)) OVER (ORDER BY at DESC, seq DESC ROWS UNBOUNDED PRECEDING) AS read
     FROM (
       SELECT m.content AS text, m.created_at AS at, 0 AS seq FROM messages m
       WHERE m.conversation_id = $1
         AND m.created_at < (SELECT message_at FROM current)
         AND m.created_at > (SELECT at FROM since)
       UNION ALL
       SELECT COALESCE(e.payload->>'content', e.payload->>'delta'), e.created_at, e.seq
       FROM runs r JOIN run_events e ON e.run_id = r.id
       WHERE r.conversation_id = $1 AND r.id <> $2
         AND r.created_at < (SELECT run_at FROM current)
         AND r.created_at > (SELECT at FROM since)
         AND e.type IN ('TOOL_CALL_ARGS', 'TOOL_CALL_RESULT')
     ) texts
     WHERE text IS NOT NULL AND text <> ''
     ) counted
     WHERE read - length(text) < $4
     ORDER BY at DESC, seq DESC LIMIT $3`,
    [conversationId, runId, TEXT_ROWS, TEXT_CHARS],
  );
  return rows.map((row) => row.text).reverse();
}

export async function chatIdentifiers(
  db: Queryable,
  input: Pick<RunInput, 'identity' | 'projectRoots'>,
): Promise<string> {
  try {
    const [texts, secretValues] = await Promise.all([
      chatTexts(db, input.identity.threadId, input.identity.runId),
      projectSecretValues(input.projectRoots),
    ]);
    return identifiersText(extractAnchors(texts, { secretValues }));
  } catch (error) {
    console.error('Could not list the exact identifiers in the chat', error);
    return '';
  }
}
