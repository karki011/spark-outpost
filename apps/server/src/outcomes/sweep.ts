import type { Db } from '../persistence/db.ts';
import { refreshOutcome, type OutcomeOptions } from './record.ts';

export const SWEEP_EVERY_MS = 10 * 60 * 1000;
export const SWEEP_BATCH = 200;
const SWEEP_LOOKBACK_DAYS = 30;

export async function unsettledTurns(db: Db, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN task_outcomes o ON o.run_id = r.id
     WHERE c.workspace_id = $1 AND r.parent_run_id IS NULL AND r.role IS DISTINCT FROM 'digest'
       AND r.status IN ('succeeded', 'failed', 'cancelled', 'outcome_unknown')
       AND r.finished_at > now() - make_interval(days => $2)
       AND (o.run_id IS NULL OR o.settled_at IS NULL)
     ORDER BY r.finished_at
     LIMIT $3`,
    [workspaceId, SWEEP_LOOKBACK_DAYS, SWEEP_BATCH],
  );
  return rows.map((row) => row.id);
}

export async function sweepOutcomes(
  db: Db,
  workspaceId: string,
  options: OutcomeOptions = {},
): Promise<number> {
  const runIds = await unsettledTurns(db, workspaceId);
  for (const runId of runIds) {
    await refreshOutcome(db, workspaceId, runId, { ...options, checkCommits: true }).catch(
      (error: unknown) => console.error(`Could not refresh the outcome of run ${runId}`, error),
    );
  }
  return runIds.length;
}

export interface OutcomeSweep {
  stop(): void;
}

export function startOutcomeSweep(
  db: Db,
  workspaceId: string,
  options: OutcomeOptions & { everyMs?: number } = {},
): OutcomeSweep {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sweepOutcomes(db, workspaceId, options);
    } catch (error) {
      console.error('The outcome sweep failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), options.everyMs ?? SWEEP_EVERY_MS);
  timer.unref();
  const first = setTimeout(() => void tick(), 5_000);
  first.unref();
  return {
    stop() {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
