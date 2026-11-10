import { NEEDS_YOU_PREFIX, needsYouLines } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

interface CandidateRow {
  outpost_id: string;
  asks_approval: boolean;
  reply: string | null;
}

export async function needsYouCounts(
  db: Queryable,
  workspaceId: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<CandidateRow>(
    `SELECT outpost_id, asks_approval, reply FROM (
       SELECT p.outpost_id,
         (r.status = 'awaiting_approval') AS asks_approval,
         CASE WHEN r.status = 'succeeded' THEN (
           SELECT work.text FROM (${workReply('r.id')}) work
           WHERE strpos(work.text, '${NEEDS_YOU_PREFIX}') > 0
         ) END AS reply
       FROM outpost_posts p
       JOIN outposts o ON o.id = p.outpost_id AND o.workspace_id = $1
       JOIN runs r ON r.id = p.run_id
       WHERE p.kind = 'request' AND p.closed_state IS NULL AND p.to_conversation_id IS NOT NULL
         AND r.status IN ('awaiting_approval', 'succeeded')
         AND (r.status = 'succeeded' OR EXISTS (
           SELECT 1 FROM approvals a JOIN runs ar ON ar.id = a.run_id
           WHERE a.status = 'pending' AND (ar.id = r.id OR ar.parent_run_id = r.id)
         ))
     ) candidates
     WHERE asks_approval OR reply IS NOT NULL`,
    [workspaceId],
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const asks = row.asks_approval || needsYouLines(row.reply ?? '')[0] !== undefined;
    if (asks) counts.set(row.outpost_id, (counts.get(row.outpost_id) ?? 0) + 1);
  }
  return counts;
}
