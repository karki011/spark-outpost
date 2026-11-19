import { todoListSchema } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { NaturalBreak } from './policy.ts';

interface PreviousTurn {
  status: string;
  todo: unknown;
  pull_request: boolean;
}

export function planDone(todo: unknown): boolean {
  const entries = todoListSchema.safeParse(todo).data ?? [];
  return entries.length > 0 && entries.every((entry) => entry.status === 'completed');
}

export function breakOf(turn: PreviousTurn | undefined): NaturalBreak | null {
  if (!turn || turn.status !== 'succeeded') return null;
  if (turn.pull_request) return 'pull-request';
  return planDone(turn.todo) ? 'plan-done' : null;
}

export async function naturalBreak(
  db: Queryable,
  input: Pick<RunInput, 'identity'>,
): Promise<NaturalBreak | null> {
  const { rows } = await db.query<PreviousTurn>(
    `WITH previous AS (
       SELECT r.status, r.todo, r.created_at, COALESCE(r.finished_at, now()) AS ended_at
       FROM runs r
       WHERE r.conversation_id = $1 AND r.parent_run_id IS NULL AND r.id <> $2
         AND r.created_at < (SELECT created_at FROM runs WHERE id = $2)
       ORDER BY r.created_at DESC, r.id DESC LIMIT 1
     )
     SELECT p.status, p.todo,
       EXISTS (
         SELECT 1 FROM task_links tl JOIN tasks t ON t.id = tl.task_id
         WHERE t.conversation_id = $1 AND tl.kind = 'pr'
           AND tl.created_at BETWEEN p.created_at AND p.ended_at
       ) OR EXISTS (
         SELECT 1 FROM task_ships s JOIN tasks t ON t.id = s.task_id
         WHERE t.conversation_id = $1 AND s.pr_number IS NOT NULL
           AND s.pushed_at BETWEEN p.created_at AND p.ended_at
       ) AS pull_request
     FROM previous p`,
    [input.identity.threadId, input.identity.runId],
  );
  return breakOf(rows[0]);
}
