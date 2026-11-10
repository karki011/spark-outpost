import type { OutpostExchange } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { StoredPost } from '../outposts/ports.ts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

interface ExchangeRow {
  post_id: string;
  question: string | null;
  answer: string | null;
}

export async function requestsExchanges(
  db: Queryable,
  posts: readonly StoredPost[],
): Promise<Map<string, OutpostExchange[]>> {
  const exchanges = new Map<string, OutpostExchange[]>();
  const asked = posts.filter(
    (post): post is StoredPost & { runId: string } =>
      post.kind === 'request' && post.runId !== null,
  );
  if (asked.length === 0) return exchanges;
  const { rows } = await db.query<ExchangeRow>(
    `WITH asked AS (
       SELECT * FROM unnest($1::uuid[], $2::uuid[]) AS a(post_id, run_id)
     ),
     turns AS (
       SELECT asked.post_id, turn.id, turn.created_at,
         (${workReply('turn.id')}) AS reply,
         (SELECT said.content FROM messages said
          WHERE said.id = turn.user_message_id AND said.role = 'user') AS said
       FROM asked
       JOIN runs latest ON latest.id = asked.run_id
       JOIN runs first ON first.conversation_id = latest.conversation_id
         AND first.source = 'outpost' AND first.user_message_id = asked.post_id
       JOIN runs turn ON turn.conversation_id = latest.conversation_id
         AND turn.parent_run_id IS NULL
         AND turn.created_at BETWEEN first.created_at AND latest.created_at
     )
     SELECT post_id, reply AS question,
       LEAD(said) OVER (PARTITION BY post_id ORDER BY created_at, id) AS answer
     FROM turns ORDER BY post_id, created_at, id`,
    [asked.map((post) => post.id), asked.map((post) => post.runId)],
  );
  for (const { post_id: postId, question, answer } of rows) {
    if (answer === null) continue;
    const list = exchanges.get(postId) ?? [];
    list.push({ question: redactText(question ?? '').trim(), answer: redactText(answer).trim() });
    exchanges.set(postId, list);
  }
  return exchanges;
}

export async function requestExchanges(
  db: Queryable,
  post: StoredPost,
): Promise<OutpostExchange[]> {
  return (await requestsExchanges(db, [post])).get(post.id) ?? [];
}
