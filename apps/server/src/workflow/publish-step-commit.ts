import { clipAtWord, SHIP_TITLE_MAX_LENGTH } from '@spark-outpost/contracts';
import { runTask, taskTitle } from '../persistence/tasks.ts';
import { planShip, type ShipDeps } from '../ship/prepare.ts';
import { shipTask } from '../ship/service.ts';
import { committedLine, notCommittedLine } from './publish-step-lines.ts';

export interface LocalCommit {
  runId: string;
  request: string;
  reply: string;
}

export async function commitWithoutRemote(
  deps: ShipDeps,
  commit: LocalCommit,
): Promise<string | null> {
  const task = await runTask(deps.db, commit.runId);
  if (!task) return null;
  const options = { duringRun: true, subject: taskTitle(commit.request), summary: commit.reply };
  try {
    const plan = await planShip(deps, task.taskId, options);
    if (plan.blocked || !plan.modes.includes('commit')) return null;
    const title = clipAtWord(plan.task.title, SHIP_TITLE_MAX_LENGTH);
    const result = await shipTask(deps, task.taskId, { mode: 'commit', title }, options);
    return committedLine(result, plan.notes[0] ?? null);
  } catch (error) {
    return notCommittedLine(error);
  }
}
