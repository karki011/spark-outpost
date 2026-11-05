import { requestFor } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface OwnRow {
  body: string;
  to_handle: string | null;
  asked: string[];
}

export async function ownRequestText(db: Queryable, postId: string): Promise<string | null> {
  const { rows } = await db.query<OwnRow>(
    `SELECT p.body, p.to_handle,
       ARRAY(
         SELECT b.to_handle FROM outpost_posts b
         WHERE b.batch_id = p.batch_id AND b.to_handle IS NOT NULL
       ) AS asked
     FROM outpost_posts p
     WHERE p.id = $1 AND p.kind = 'request' AND p.from_user AND p.batch_id IS NOT NULL`,
    [postId],
  );
  const row = rows[0];
  if (!row?.to_handle) return null;
  return requestFor(row.body, row.to_handle, row.asked);
}
