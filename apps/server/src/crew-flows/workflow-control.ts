import type { WorkflowControlAction } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../api/run-target.ts';
import type { Db } from '../persistence/db.ts';
import { requestCancel } from '../persistence/runs.ts';
import { getWorkflowRun } from './run-records.ts';
import { deleteSchedule } from './schedule-records.ts';
import { startWorkflowRun } from './start-run.ts';
import { setWorkflowSchedule, setWorkflowTriggers } from './workflow-settings.ts';
import { workflowStore, type WorkflowStore } from './workflow-store.ts';

export interface WorkflowControlDeps {
  db: Db;
  workspaceId: string;
  chatFolders?: string | undefined;
  store?: WorkflowStore;
  now?: () => Date;
}

export interface WorkflowControlDone {
  message: string;
  output: Record<string, unknown>;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`This card has no ${what}. Ask the agent again.`);
  return value;
}

async function run(deps: WorkflowControlDeps, action: WorkflowControlAction) {
  const { db, workspaceId } = deps;
  const messageId = required(action.messageId, 'message id');
  const started = await startWorkflowRun(
    {
      db,
      workspaceId,
      store: deps.store ?? workflowStore(),
      runTarget: (conversationId) => resolveRunTarget({ db, workspaceId }, conversationId),
      chatFolders: deps.chatFolders,
    },
    {
      kind: 'run',
      workflowId: action.workflowId,
      messageId,
      source: 'agent',
      conversationId: null,
      projectId: action.project?.id ?? null,
      message: action.message,
    },
  );
  return {
    message: `Started the ${action.name} workflow in a new chat.`,
    output: { workflowRunId: started.id, chatId: started.conversationId },
  };
}

async function stop(deps: WorkflowControlDeps, action: WorkflowControlAction) {
  const id = required(action.workflowRunId, 'workflow run');
  const found = await getWorkflowRun(deps.db, deps.workspaceId, id);
  if (!found || found.workflowId !== action.workflowId) {
    throw new Error(`That run of the ${action.name} workflow no longer exists.`);
  }
  const output = { workflowRunId: found.id };
  if (found.status !== 'running' || !found.runId) {
    return { message: `That ${action.name} workflow run had already ended.`, output };
  }
  await requestCancel(deps.db, found.runId);
  return { message: `Stopped the ${action.name} workflow run.`, output };
}

export async function controlWorkflow(
  deps: WorkflowControlDeps,
  action: WorkflowControlAction,
): Promise<WorkflowControlDone> {
  const { db, workspaceId } = deps;
  switch (action.op) {
    case 'run':
      return run(deps, action);
    case 'stop':
      return stop(deps, action);
    case 'schedule':
      await setWorkflowSchedule(
        db,
        workspaceId,
        action.workflowId,
        required(action.schedule, 'schedule'),
        (deps.now ?? (() => new Date()))(),
      );
      return { message: `Scheduled the ${action.name} workflow.`, output: {} };
    case 'unschedule':
      await deleteSchedule(db, workspaceId, action.workflowId);
      return { message: `Turned off the ${action.name} workflow’s schedule.`, output: {} };
    case 'triggers':
      await setWorkflowTriggers(
        db,
        workspaceId,
        action.workflowId,
        required(action.triggers, 'triggers'),
      );
      return { message: `Saved the ${action.name} workflow’s triggers.`, output: {} };
  }
}
