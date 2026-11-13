import {
  workflowProblems,
  type StartWorkflowRun,
  type WorkflowRun,
  type WorkflowRunSource,
} from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import { assistantConversationId } from '../companion/assistant-settings.ts';
import {
  ConversationNotFoundError,
  createConversation,
  sendInTransaction,
  type RunTarget,
} from '../persistence/conversations.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { getWorkflowRun, insertWorkflowRun } from './run-records.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import {
  WorkflowNotFoundError,
  WorkflowProblemsError,
  type WorkflowStore,
} from './workflow-store.ts';

export interface StartRunDeps {
  db: Db;
  workspaceId: string;
  store: WorkflowStore;
  runTarget(conversationId: string): Promise<RunTarget>;
}

export interface StartRun extends StartWorkflowRun {
  workflowId: string;
  messageId: string;
  source: Extract<WorkflowRunSource, 'manual' | 'schedule' | 'catch_up'>;
}

async function existingRun(deps: StartRunDeps, messageId: string): Promise<WorkflowRun | null> {
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT w.id FROM workflow_runs w JOIN runs r ON r.id = w.run_id
     WHERE r.user_message_id = $1 AND w.workspace_id = $2`,
    [messageId, deps.workspaceId],
  );
  return rows[0] ? getWorkflowRun(deps.db, deps.workspaceId, rows[0].id) : null;
}

async function ownChat(deps: StartRunDeps, conversationId: string): Promise<boolean> {
  const { rowCount } = await deps.db.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2 AND session_type = 'chat'`,
    [conversationId, deps.workspaceId],
  );
  return rowCount === 1;
}

export async function startWorkflowRun(deps: StartRunDeps, start: StartRun): Promise<WorkflowRun> {
  if (start.kind !== 'run') throw new BadRequestError('Test runs are not available yet.');
  const repeated = await existingRun(deps, start.messageId);
  if (repeated) return repeated;
  const file = await deps.store.read(start.workflowId);
  if (!file) throw new WorkflowNotFoundError(start.workflowId);
  const { workflow } = file;
  const problems = workflowProblems(
    workflow.steps,
    await workspaceSparkIds(deps.db, deps.workspaceId),
  );
  if (problems.length > 0) throw new WorkflowProblemsError(problems);
  const assistantChat = await assistantConversationId(deps.db, deps.workspaceId);
  if (start.conversationId !== null && start.conversationId === assistantChat) {
    throw new BadRequestError('A workflow can’t run in the Ask Spark chat.');
  }
  if (start.conversationId !== null && !(await ownChat(deps, start.conversationId))) {
    throw new ConversationNotFoundError(start.conversationId);
  }
  const conversationId = start.conversationId ?? newId();
  const target = await deps.runTarget(conversationId);
  const message = start.message.trim();
  const id = newId();
  await withTransaction(deps.db, async (client) => {
    if (start.conversationId === null) {
      await createConversation(client, deps.workspaceId, conversationId, {
        title: workflow.name,
        ...(start.projectId ? { projectIds: [start.projectId] } : {}),
      });
    }
    const sent = await sendInTransaction(
      client,
      conversationId,
      {
        id: start.messageId,
        content: message ? `@${workflow.id} ${message}` : `@${workflow.id}`,
        source: 'workflow',
      },
      target,
    );
    await insertWorkflowRun(client, {
      id,
      workspaceId: deps.workspaceId,
      workflow,
      kind: start.kind,
      source: start.source,
      conversationId,
      runId: sent.run.id,
      message,
      continues: false,
    });
  });
  const run =
    (await getWorkflowRun(deps.db, deps.workspaceId, id)) ??
    (await existingRun(deps, start.messageId));
  if (!run) throw new Error('The workflow run was not recorded.');
  return run;
}
