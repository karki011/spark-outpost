import type { WorkflowSchedule, WorkflowTriggers } from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { projectLinked, saveSchedule } from './schedule-records.ts';
import { seedPullMarks } from './trigger-events.ts';
import { getTriggers, saveTriggers } from './trigger-records.ts';

async function assertProject(db: Db, workspaceId: string, projectId: string | null) {
  if (projectId !== null && !(await projectLinked(db, workspaceId, projectId))) {
    throw new BadRequestError('That project is not in Spark.');
  }
}

export async function setWorkflowSchedule(
  db: Db,
  workspaceId: string,
  workflowId: string,
  schedule: WorkflowSchedule,
  now: Date,
): Promise<void> {
  await assertProject(db, workspaceId, schedule.projectId);
  await saveSchedule(db, workspaceId, workflowId, schedule, now);
}

export async function setWorkflowTriggers(
  db: Db,
  workspaceId: string,
  workflowId: string,
  triggers: WorkflowTriggers,
): Promise<void> {
  await assertProject(db, workspaceId, triggers.projectId);
  const before = await getTriggers(db, workspaceId, workflowId);
  await saveTriggers(db, workspaceId, workflowId, triggers);
  const watching = before?.triggers.pullRequest === true;
  if (triggers.pullRequest && !watching) {
    await seedPullMarks(db, workspaceId, workflowId, triggers.projectId);
  }
}
