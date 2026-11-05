import type { OutpostExchange } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { StoredPost } from '../outposts/ports.ts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

interface ExchangeRow {
  question: string | null;
  answer: string | null;
}

export async function requestExchanges(
  db: Queryable,
  post: StoredPost,
): Promise<OutpostExchange[]> {
  if (post.kind !== 'request' || post.runId === null) return [];
  const { rows } = await db.query<ExchangeRow>(
    `WITH turns AS (
       SELECT turn.id, turn.created_at,
         (${workReply('turn.id')}) AS reply,
         (SELECT said.content FROM messages said
          WHERE said.id = turn.user_message_id AND said.role = 'user') AS said
       FROM runs latest
       JOIN runs first ON first.conversation_id = latest.conversation_id
         AND first.source = 'outpost' AND first.user_message_id = $2
       JOIN runs turn ON turn.conversation_id = latest.conversation_id
         AND turn.parent_run_id IS NULL
         AND turn.created_at BETWEEN first.created_at AND latest.created_at
       WHERE latest.id = $1
     )
     SELECT reply AS question, LEAD(said) OVER (ORDER BY created_at, id) AS answer
     FROM turns ORDER BY created_at, id`,
    [post.runId, post.id],
  );
  return rows.flatMap(({ question, answer }) =>
    answer === null
      ? []
      : [{ question: redactText(question ?? '').trim(), answer: redactText(answer).trim() }],
  );
}
