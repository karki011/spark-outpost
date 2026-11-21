import { chatTaskIds } from '../persistence/tasks.ts';
import { planShip, type ShipDeps, type ShipPlan } from '../ship/prepare.ts';
import { shipTask } from '../ship/service.ts';
import { stackParentOf } from './stack-base.ts';

type Pending = 'none' | 'commit' | 'blocked';

const NOTHING_TO_COMMIT: ReadonlySet<string> = new Set(['no_changes', 'nothing_new']);

function pendingOn(plan: ShipPlan, branch: string): Pending {
  if (plan.blocked) return NOTHING_TO_COMMIT.has(plan.blocked.reason) ? 'none' : 'blocked';
  if (plan.files.length === 0) return 'none';
  return plan.branch === branch && plan.modes.includes('commit') ? 'commit' : 'blocked';
}

async function commitKeptWork(deps: ShipDeps, chatId: string, branch: string): Promise<boolean> {
  for (const taskId of await chatTaskIds(deps.db, chatId)) {
    const pending = pendingOn(await planShip(deps, taskId), branch);
    if (pending === 'blocked') return false;
    if (pending === 'commit') await shipTask(deps, taskId, { mode: 'commit' });
  }
  return true;
}

export async function stackedOnWorkCommitted(deps: ShipDeps, subChatId: string): Promise<boolean> {
  const parent = await stackParentOf(deps.db, subChatId);
  if (!parent || parent.branch === null) return true;
  return commitKeptWork(deps, parent.parentChatId, parent.branch);
}
