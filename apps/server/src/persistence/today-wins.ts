import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface ChatWins {
  id: string;
  kept: number;
  prs: number;
  tickets: number;
}

export async function chatWins(
  db: Queryable,
  ids: readonly string[],
  since: Date,
): Promise<ChatWins[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<ChatWins>(
    `SELECT c.id,
       (SELECT count(*) FROM approvals a JOIN runs r ON r.id = a.run_id
        WHERE r.conversation_id = c.id AND a.kind = 'accept' AND a.decision_option_id = $3
          AND a.decided_at >= $2)::int AS kept,
       (SELECT count(*) FROM task_ships s JOIN tasks t ON t.id = s.task_id
        WHERE t.conversation_id = c.id AND s.pr_url IS NOT NULL AND s.updated_at >= $2)::int
         AS prs,
       (SELECT count(*) FROM (
          SELECT tt.source, tt.ticket_key FROM task_tickets tt JOIN tasks t ON t.id = tt.task_id
          WHERE t.conversation_id = c.id AND tt.created_at >= $2
          UNION
          SELECT e.source, e.ticket_key FROM ticket_events e JOIN tasks t ON t.id = e.task_id
          WHERE t.conversation_id = c.id AND e.at >= $2 AND e.outcome = 'succeeded'
            AND e.ticket_key IS NOT NULL
        ) touched)::int AS tickets
     FROM conversations c WHERE c.id = ANY($1::uuid[])`,
    [ids, since, CHECKPOINT_OPTION.keep],
  );
  return rows;
}
