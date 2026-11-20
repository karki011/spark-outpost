import { planTitle } from '../titles/plan-title.ts';
import type { Queryable } from './db.ts';

export async function retitleFromPlan(
  db: Queryable,
  conversationId: string,
  body: string,
  runId: string | null,
): Promise<string | null> {
  const title = planTitle(body);
  if (!title) return null;
  const { rows } = await db.query<{ title: string }>(
    `UPDATE conversations c SET title = $2, title_source = 'auto',
       title_category = COALESCE((SELECT r.category FROM runs r WHERE r.id = $3), c.title_category)
     WHERE c.id = $1 AND c.title_source <> 'user' AND (c.title <> $2 OR c.title_source = 'message')
       AND NOT EXISTS (
         SELECT 1 FROM conversation_tickets ct
         WHERE ct.conversation_id = c.id AND ct.state = 'linked'
         UNION ALL
         SELECT 1 FROM task_tickets tt JOIN tasks t ON t.id = tt.task_id
         WHERE t.conversation_id = c.id
       )
     RETURNING c.title`,
    [conversationId, title, runId],
  );
  return rows[0]?.title ?? null;
}
