import type { SparkPause } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { pollWaitingRounds } from '../persistence/pr-watches.ts';
import { setSparkPaused } from '../persistence/spark-pause.ts';
import { drainWaiting, type ResolveTarget } from './queue-drain.ts';

async function announce(db: Db): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'spark_pause', conversationId: null, runId: null }),
  ]);
}

async function releaseHeld(db: Db, workspaceId: string, resolveTarget: ResolveTarget) {
  await pollWaitingRounds(db, workspaceId);
  await drainWaiting(db, resolveTarget);
}

export async function changeSparkPause(
  db: Db,
  workspaceId: string,
  paused: boolean,
  resolveTarget: ResolveTarget,
): Promise<SparkPause> {
  const state = await setSparkPaused(db, workspaceId, paused);
  await announce(db);
  if (!paused) {
    await releaseHeld(db, workspaceId, resolveTarget).catch((error: unknown) =>
      console.error('Could not start the work held while Spark was paused', error),
    );
  }
  return state;
}
