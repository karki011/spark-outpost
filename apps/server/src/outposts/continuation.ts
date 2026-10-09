import { needsYouLines } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

const USER_SENT_SOURCES: readonly (string | null)[] = [null, 'ui', 'e2e', 'bench', 'queue'];

export interface ContinuationFacts {
  source: string | null;
  previousStatus: string | null;
  previousReply: string | null;
}

export function continuesRequest(facts: ContinuationFacts): boolean {
  if (!USER_SENT_SOURCES.includes(facts.source)) return false;
  if (facts.previousStatus !== 'succeeded') return false;
  return needsYouLines(facts.previousReply ?? '').length > 0;
}

interface TurnRow {
  source: string | null;
  previous_id: string | null;
  previous_status: string | null;
  previous_reply: string | null;
}

export async function continueOpenRequest(
  db: Queryable,
  chatId: string,
  runId: string,
): Promise<void> {
  const { rows } = await db.query<TurnRow>(
    `SELECT r.source, p.id AS previous_id, p.status AS previous_status,
            (SELECT m.content FROM messages m
             WHERE m.run_id = p.id AND m.role = 'assistant'
             ORDER BY m.created_at DESC LIMIT 1) AS previous_reply
     FROM runs r
     LEFT JOIN LATERAL (
       SELECT e.id, e.status FROM runs e
       WHERE e.conversation_id = r.conversation_id AND e.parent_run_id IS NULL AND e.id <> r.id
       ORDER BY e.created_at DESC LIMIT 1
     ) p ON true
     WHERE r.id = $2 AND r.conversation_id = $1 AND r.parent_run_id IS NULL`,
    [chatId, runId],
  );
  const turn = rows[0];
  if (!turn?.previous_id) return;
  const continues = continuesRequest({
    source: turn.source,
    previousStatus: turn.previous_status,
    previousReply: turn.previous_reply,
  });
  if (!continues) return;
  await db.query(
    `UPDATE outpost_posts SET run_id = $3
     WHERE to_conversation_id = $1 AND run_id = $2 AND kind = 'request' AND closed_state IS NULL`,
    [chatId, turn.previous_id, runId],
  );
}
