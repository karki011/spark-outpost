import type { RailFlag, RailFlagDecision } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { getRailFlag, revertTargetRun, settleRailFlag } from '../persistence/rail-flags.ts';
import { RevertConflictError, revertRun } from './run-changes.ts';

export async function decideRailFlag(
  db: Queryable,
  workspaceId: string,
  flagId: string,
  decision: RailFlagDecision,
): Promise<RailFlag> {
  const flag = await getRailFlag(db, workspaceId, flagId);
  if (flag.status !== 'open') return flag;
  if (decision.action === 'revert') {
    if (!flag.inside) {
      throw new RevertConflictError("Spark can't revert changes outside the project.");
    }
    const target = await revertTargetRun(db, flag.runId);
    await revertRun(db, workspaceId, target);
  }
  await settleRailFlag(db, flagId, decision.action);
  return getRailFlag(db, workspaceId, flagId);
}
