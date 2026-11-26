import {
  type StartSparkTestRun,
  type StartWorkflowRun,
  type WorkflowRun,
  type WorkflowRunSource,
  type WorkflowTriggerKind,
} from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import { assistantConversationId } from '../companion/assistant-settings.ts';
import {
  ConversationNotFoundError,
  createConversation,
  sendInTransaction,
  type RunTarget,
} from '../persistence/conversations.ts';
import { copyChatAgent } from '../persistence/chat-settings.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { getWorkflowRun, insertWorkflowRun } from './run-records.ts';
import { WORKFLOW_LANE } from '../persistence/chat-turns.ts';
import { runnableWorkflow } from './runnable.ts';
import { stepSparks, workspaceSparkIds } from './step-sparks.ts';
import { oneSparkWorkflow, startTestRun } from './test-run.ts';
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
  chatFolders?: string | undefined;
  deleteSettleMs?: number | undefined;
}

export class SparkNotFoundError extends Error {
  constructor() {
    super('That Spark no longer exists.');
  }
}

export interface StartRun extends StartWorkflowRun {
  workflowId: string;
  messageId: string;
  source: Extract<WorkflowRunSource, 'manual' | 'schedule' | 'catch_up' | 'trigger' | 'agent'>;
  trigger?: { kind: WorkflowTriggerKind; diffHash: string | null };
  edits?: boolean;
  settingsFrom?: string | null;
}

export async function existingRun(
  deps: Pick<StartRunDeps, 'db' | 'workspaceId'>,
  messageId: string,
): Promise<WorkflowRun | null> {
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

async function callerChat(deps: StartRunDeps, start: StartRun): Promise<string | null> {
  const from = start.settingsFrom ?? null;
  return from !== null && (await ownChat(deps, from)) ? from : null;
}

export async function startSparkTestRun(
  deps: StartRunDeps,
  start: StartSparkTestRun & { sparkId: string; messageId: string },
): Promise<WorkflowRun> {
  const repeated = await existingRun(deps, start.messageId);
  if (repeated) return repeated;
  const spark = (await stepSparks(deps.db, deps.workspaceId, [start.sparkId])).get(start.sparkId);
  if (!spark) throw new SparkNotFoundError();
  return startTestRun(deps, {
    workflow: oneSparkWorkflow(spark),
    message: start.message.trim(),
    projectId: start.projectId,
    messageId: start.messageId,
    oneSpark: true,
  });
}

export async function startWorkflowRun(deps: StartRunDeps, start: StartRun): Promise<WorkflowRun> {
  const repeated = await existingRun(deps, start.messageId);
  if (repeated) return repeated;
  const file = await deps.store.read(start.workflowId);
  if (!file) throw new WorkflowNotFoundError(start.workflowId);
  const { workflow, problems } = await runnableWorkflow(
    deps.store,
    file.workflow,
    await workspaceSparkIds(deps.db, deps.workspaceId),
  );
  if (!workflow) throw new WorkflowProblemsError(problems);
  if (start.kind === 'test') {
    return startTestRun(deps, {
      workflow,
      message: start.message.trim(),
      projectId: start.projectId,
      messageId: start.messageId,
      oneSpark: false,
    });
  }
  const assistantChat = await assistantConversationId(deps.db, deps.workspaceId);
  if (start.conversationId !== null && start.conversationId === assistantChat) {
    throw new BadRequestError('A workflow can’t run in the Ask Spark chat.');
  }
  if (start.conversationId !== null && !(await ownChat(deps, start.conversationId))) {
    throw new ConversationNotFoundError(start.conversationId);
  }
  const conversationId = start.conversationId ?? newId();
  const settingsFrom = start.conversationId === null ? await callerChat(deps, start) : null;
  const target = await deps.runTarget(settingsFrom ?? conversationId);
  const message = start.message.trim();
  const id = newId();
  await withTransaction(deps.db, async (client) => {
    if (start.conversationId === null) {
      await createConversation(client, deps.workspaceId, conversationId, {
        title: workflow.name,
        ...(start.projectId ? { projectIds: [start.projectId] } : {}),
      });
      if (settingsFrom) await copyChatAgent(client, settingsFrom, conversationId);
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
    if (start.kind === 'run') {
      await client.query('UPDATE runs SET route = $2 WHERE id = $1', [
        sent.run.id,
        JSON.stringify({ [WORKFLOW_LANE]: true }),
      ]);
    }
    await insertWorkflowRun(client, {
      id,
      workspaceId: deps.workspaceId,
      workflow,
      kind: start.kind,
      source: start.source,
      conversationId,
      runId: sent.run.id,
      message,
      continues: start.kind === 'run',
      ...(start.trigger
        ? { triggerKind: start.trigger.kind, diffHash: start.trigger.diffHash }
        : {}),
      edits: start.edits === true,
    });
  });
  const run =
    (await getWorkflowRun(deps.db, deps.workspaceId, id)) ??
    (await existingRun(deps, start.messageId));
  if (!run) throw new Error('The workflow run was not recorded.');
  return run;
}
