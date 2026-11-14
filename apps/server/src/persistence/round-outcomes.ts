import { roundOutcomeSchema, type RoundOutcome } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export async function recordRoundOutcome(
  db: Queryable,
  watchId: string,
  outcome: RoundOutcome,
): Promise<void> {
  await db.query(
    `UPDATE pr_watches SET round_outcomes = COALESCE((
       SELECT jsonb_agg(kept ORDER BY ordinality) FROM jsonb_array_elements(round_outcomes)
         WITH ORDINALITY AS listed (kept, ordinality)
       WHERE kept->>'runId' <> $2
     ), '[]'::jsonb) || jsonb_build_array($3::jsonb)
     WHERE id = $1`,
    [watchId, outcome.runId, JSON.stringify(outcome)],
  );
}

export function roundOutcomesOf(stored: unknown): RoundOutcome[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const parsed = roundOutcomeSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
