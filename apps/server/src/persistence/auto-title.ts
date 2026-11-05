import { categorySchema, type TitleSource } from '@spark-outpost/contracts';
import { decideAutoTitle, type AutoTitle } from '../titles/auto-title.ts';
import type { Queryable } from './db.ts';
import { ownRequestText } from './outpost-own-request.ts';

export async function recordSuggestedTitle(
  db: Queryable,
  runId: string,
  title: string,
): Promise<void> {
  await db.query('UPDATE runs SET suggested_title = $2 WHERE id = $1', [runId, title]);
}

interface TitleRow {
  conversation_id: string;
  user_message_id: string;
  category: string | null;
  request: string;
  title: string;
  title_source: TitleSource;
  title_category: string | null;
  suggested: string | null;
  has_linked_ticket: boolean;
}

const asCategory = (value: string | null) => categorySchema.safeParse(value).data ?? null;

export async function applyAutoTitle(db: Queryable, runId: string): Promise<AutoTitle | null> {
  const { rows } = await db.query<TitleRow>(
    `SELECT r.conversation_id, r.user_message_id, r.category, m.content AS request, c.title, c.title_source,
       c.title_category,
       (SELECT s.suggested_title FROM runs s
        WHERE (s.id = r.id OR s.parent_run_id = r.id) AND s.suggested_title IS NOT NULL
        ORDER BY s.id = r.id DESC, s.created_at LIMIT 1) AS suggested,
       EXISTS (
         SELECT 1 FROM conversation_tickets ct
         WHERE ct.conversation_id = r.conversation_id AND ct.state = 'linked'
         UNION ALL
         SELECT 1 FROM task_tickets tt JOIN tasks t ON t.id = tt.task_id
         WHERE t.conversation_id = r.conversation_id
       ) AS has_linked_ticket
     FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     JOIN messages m ON m.id = r.user_message_id
     WHERE r.id = $1 AND r.parent_run_id IS NULL
     FOR UPDATE OF c`,
    [runId],
  );
  const row = rows[0];
  if (!row || row.has_linked_ticket) return null;
  const decided = decideAutoTitle(
    { title: row.title, source: row.title_source, category: asCategory(row.title_category) },
    {
      suggested: row.suggested,
      category: asCategory(row.category),
      request: (await ownRequestText(db, row.user_message_id)) ?? row.request,
    },
  );
  if (!decided) return null;
  await db.query(
    `UPDATE conversations SET title = $2, title_source = 'auto', title_category = $3
     WHERE id = $1 AND title_source <> 'user'`,
    [row.conversation_id, decided.title, decided.category],
  );
  await db.query(
    `UPDATE run_advice SET body = body || jsonb_build_object('title', $2::jsonb)
     WHERE run_id = $1 AND purpose = 'intake'`,
    [runId, JSON.stringify({ text: decided.title, origin: decided.origin })],
  );
  return decided;
}
