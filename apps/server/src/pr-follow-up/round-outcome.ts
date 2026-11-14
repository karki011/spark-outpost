import type { RoundOutcome } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { Watch } from '../persistence/pr-watches.ts';
import { recordRoundOutcome } from '../persistence/round-outcomes.ts';

const REVIEW_REQUEST = '(--add-reviewer|/requested_reviewers)';

export async function rerequestedReview(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM run_commands c JOIN runs r ON r.id = c.run_id
       WHERE (r.id = $1 OR r.parent_run_id = $1) AND c.status = 'completed'
         AND COALESCE(c.exit_code, 0) = 0 AND c.command ~ $2
     ) AS found`,
    [runId, REVIEW_REQUEST],
  );
  return rows[0]?.found === true;
}

export type RoundFacts = Omit<RoundOutcome, 'runId' | 'round' | 'rerequested'>;

export const UNFINISHED: Omit<RoundFacts, 'ended'> = {
  pushed: false,
  merged: false,
  replied: 0,
  needs: 0,
  unpushed: false,
};

export async function noteRoundOutcome(
  db: Queryable,
  watch: Pick<Watch, 'id' | 'roundRunId' | 'rounds'>,
  facts: RoundFacts,
): Promise<void> {
  const runId = watch.roundRunId;
  if (!runId) return;
  try {
    const rerequested = facts.ended === 'settled' && (await rerequestedReview(db, runId));
    await recordRoundOutcome(db, watch.id, { ...facts, runId, round: watch.rounds, rerequested });
  } catch (error) {
    console.error('Could not record the follow-up round outcome', error);
  }
}
