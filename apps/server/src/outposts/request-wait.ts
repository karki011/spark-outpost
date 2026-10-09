import { requestState, type RequestState } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { getPost } from '../persistence/outpost-posts.ts';
import type { PostWithFacts } from './ports.ts';
import type { OpenWait } from './wait-cycle.ts';

export interface RequestWakes {
  next(signal: AbortSignal): Promise<void>;
}

const STILL_OPEN: ReadonlySet<RequestState> = new Set<RequestState>(['sent', 'working']);

export function stillOpen(found: PostWithFacts): boolean {
  return found.facts !== null && STILL_OPEN.has(requestState(found.facts).state);
}

export async function openWaits(db: Queryable, outpostId: string): Promise<OpenWait[]> {
  const { rows } = await db.query<OpenWait>(
    `SELECT p.from_conversation_id AS "from", p.to_conversation_id AS "to"
     FROM outpost_posts p
     JOIN runs asking ON asking.id = p.from_run_id
     LEFT JOIN runs carrying ON carrying.id = p.run_id
     WHERE p.outpost_id = $1 AND p.kind = 'request' AND p.waits AND p.closed_state IS NULL
       AND p.from_conversation_id IS NOT NULL AND p.to_conversation_id IS NOT NULL
       AND asking.status IN ('queued', 'running', 'awaiting_approval')
       AND (carrying.id IS NULL OR carrying.status IN ('queued', 'running'))
     ORDER BY p.created_at, p.id`,
    [outpostId],
  );
  return rows;
}

export async function waitForRequest(
  db: Queryable,
  wakes: RequestWakes,
  postId: string,
  signal: AbortSignal,
): Promise<PostWithFacts | null> {
  for (;;) {
    const settled = new AbortController();
    const woken = wakes.next(AbortSignal.any([signal, settled.signal]));
    const found = await getPost(db, postId);
    if (found === null || !stillOpen(found) || signal.aborted) {
      settled.abort();
      return found;
    }
    await woken;
  }
}
