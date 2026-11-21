import { canStart } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { chatSparkPaused } from '../persistence/spark-pause.ts';
import { openPlans, type PlanRow } from '../persistence/sub-chat-plans.ts';
import type { ShipDeps } from '../ship/prepare.ts';
import type { ResolveTarget } from '../workflow/queue-drain.ts';
import { errorName } from './deliver-ask.ts';
import { stackedOnWorkCommitted } from './stacked-parent-work.ts';
import { startHeldSubChat } from './start.ts';

const RELEASED_AFTER_REPORTS = 'everything it waited for has reported';

export interface ReleaseDeps {
  db: Db;
  resolveTarget: ResolveTarget;
  ship?: ShipDeps | undefined;
}

async function stackedOnReady(deps: ReleaseDeps, piece: PlanRow): Promise<boolean> {
  if (!deps.ship || piece.stackedOn === null) return true;
  try {
    return await stackedOnWorkCommitted(deps.ship, piece.id);
  } catch (error) {
    console.error(
      `Sub-chat ${piece.id} stays held: the work it is stacked on was not committed (${errorName(error)}).`,
    );
    return false;
  }
}

async function release(deps: ReleaseDeps, piece: PlanRow): Promise<boolean> {
  if (await chatSparkPaused(deps.db, piece.id)) return false;
  if (!(await stackedOnReady(deps, piece))) return false;
  const start = { db: deps.db, workspaceId: piece.workspaceId, resolveTarget: deps.resolveTarget };
  return (await startHeldSubChat(start, piece.id, RELEASED_AFTER_REPORTS)).started;
}

export async function releaseHeld(deps: ReleaseDeps): Promise<number> {
  let released = 0;
  for (const pieces of await openPlans(deps.db)) {
    const plan = new Map(pieces.map((piece) => [piece.id, piece]));
    for (const piece of pieces) {
      if (!canStart(piece, plan)) continue;
      try {
        if (await release(deps, piece)) released += 1;
      } catch (error) {
        console.error(`Sub-chat ${piece.id} was not started (${errorName(error)}).`);
      }
    }
  }
  return released;
}
