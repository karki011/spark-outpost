import {
  TEST_RUN_CHAT_KIND,
  TRY_IT_WORKFLOW_ID,
  workflowSchema,
  type TestRunUsage,
  type Workflow,
  type WorkflowRun,
  type WorkflowTestRun,
} from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import { removeChatFolder } from '../chat-files/folders.ts';
import { createCopy } from '../orchestration/chat-place.ts';
import { toApproval, type ApprovalRow } from '../persistence/approvals.ts';
import { chatWorktreesOf, markChatWorktreeRemoved } from '../persistence/chat-worktrees.ts';
import { deleteConversation } from '../persistence/conversation-actions.ts';
import {
  ConversationNotFoundError,
  createConversation,
  sendInTransaction,
  type RunTarget,
} from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { conversationWorkdirs } from '../persistence/provider-sessions.ts';
import { currentBranch, deleteBranch, removeWorktreeDir } from '../projects/chat-worktrees.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import { worktreePath } from '../projects/worktrees.ts';
import { stopConversationWork } from '../workflow/stop-conversation.ts';
import { removeWorkdirs } from '../workflow/turn-session.ts';
import { heldSendsOf } from './held-sends.ts';
import { getWorkflowRun, insertWorkflowRun } from './run-records.ts';

const TEST_BRANCH_PREFIX = 'spark/test-run-';
const NOT_A_REPO =
  'A test run needs a project that is a git repository, so Spark can make a throw-away copy. Pick another project, or run it with no project.';
const COPY_FAILED = 'Spark couldn’t make a throw-away copy of this project.';
const NOT_A_TEST_RUN = 'Only a test run can be discarded.';

export class TestRunNotFoundError extends Error {
  constructor() {
    super('That test run no longer exists.');
  }
}

export interface TestRunDeps {
  db: Db;
  workspaceId: string;
  runTarget(conversationId: string): Promise<RunTarget>;
  chatFolders?: string | undefined;
  deleteSettleMs?: number | undefined;
}

export interface NewTestRun {
  workflow: Workflow;
  message: string;
  projectId: string | null;
  messageId: string;
  oneSpark: boolean;
}

export function oneSparkWorkflow(spark: { id: string; name: string }): Workflow {
  return workflowSchema.parse({
    id: TRY_IT_WORKFLOW_ID,
    name: spark.name,
    steps: [{ id: TRY_IT_WORKFLOW_ID, sparkId: spark.id }],
  });
}

async function projectRoot(deps: TestRunDeps, projectId: string): Promise<string> {
  const { rows } = await deps.db.query<{ root_path: string }>(
    'SELECT root_path FROM projects WHERE id = $1 AND workspace_id = $2',
    [projectId, deps.workspaceId],
  );
  const root = rows[0]?.root_path;
  if (!root) throw new BadRequestError('That project no longer exists.');
  if (!(await isGitWorkTree(root))) throw new BadRequestError(NOT_A_REPO);
  return root;
}

async function hiddenChat(deps: TestRunDeps, id: string, start: NewTestRun): Promise<void> {
  await withTransaction(deps.db, async (client) => {
    await createConversation(client, deps.workspaceId, id, {
      title: `Test run: ${start.workflow.name}`.slice(0, 100),
      ...(start.projectId ? { projectIds: [start.projectId] } : {}),
    });
    await client.query('UPDATE conversations SET kind = $2 WHERE id = $1', [
      id,
      TEST_RUN_CHAT_KIND,
    ]);
  });
}

async function makeCopy(
  deps: TestRunDeps,
  conversationId: string,
  projectId: string,
  root: string,
) {
  const branch = `${TEST_BRANCH_PREFIX}${conversationId.slice(0, 8)}`;
  await createCopy(
    { db: deps.db, branchPrefix: 'spark' },
    { conversationId, projectId, root },
    {
      source: { kind: 'new', branch, from: 'HEAD' },
      owned: true,
      baseBranch: await currentBranch(root),
      baseRef: null,
    },
  );
}

async function removeCopies(db: Queryable, conversationId: string): Promise<void> {
  for (const record of await chatWorktreesOf(db, conversationId)) {
    if (!record.inPlace) {
      await removeWorktreeDir(record.repoRoot, worktreePath(record.repoRoot, record.id));
      if (record.branch.startsWith(TEST_BRANCH_PREFIX)) {
        await deleteBranch(record.repoRoot, record.branch);
      }
    }
    await markChatWorktreeRemoved(db, record.id);
  }
}

async function removeChat(deps: TestRunDeps, conversationId: string): Promise<void> {
  await stopConversationWork(deps.db, conversationId, deps.deleteSettleMs);
  const workdirs = await conversationWorkdirs(deps.db, conversationId);
  await removeCopies(deps.db, conversationId);
  await deleteConversation(deps.db, deps.workspaceId, conversationId).catch((error: unknown) => {
    if (!(error instanceof ConversationNotFoundError)) throw error;
  });
  await removeWorkdirs(workdirs);
  if (deps.chatFolders) await removeChatFolder(deps.chatFolders, conversationId);
}

export async function startTestRun(deps: TestRunDeps, start: NewTestRun): Promise<WorkflowRun> {
  const root = start.projectId ? await projectRoot(deps, start.projectId) : null;
  const conversationId = newId();
  const target = await deps.runTarget(conversationId);
  await hiddenChat(deps, conversationId, start);
  const id = newId();
  try {
    if (root && start.projectId) {
      await makeCopy(deps, conversationId, start.projectId, root).catch((error: unknown) => {
        console.error('Could not make the copy for a test run', error);
        throw new BadRequestError(COPY_FAILED);
      });
    }
    const { workflow } = start;
    await withTransaction(deps.db, async (client) => {
      const sent = await sendInTransaction(
        client,
        conversationId,
        {
          id: start.messageId,
          content: start.message ? `@${workflow.id} ${start.message}` : `@${workflow.id}`,
          source: 'workflow',
        },
        target,
      );
      await insertWorkflowRun(client, {
        id,
        workspaceId: deps.workspaceId,
        workflow,
        kind: 'test',
        source: 'manual',
        conversationId,
        runId: sent.run.id,
        message: start.message,
        continues: false,
        oneSpark: start.oneSpark,
      });
    });
  } catch (error) {
    await removeChat(deps, conversationId);
    throw error;
  }
  const run = await getWorkflowRun(deps.db, deps.workspaceId, id);
  if (!run) throw new Error('The test run was not recorded.');
  return run;
}

interface TestRow {
  kind: string;
  message: string;
  one_spark: boolean;
  conversation_id: string | null;
  project_id: string | null;
  project_name: string | null;
}

async function testRow(deps: TestRunDeps, id: string): Promise<TestRow | null> {
  const { rows } = await deps.db.query<TestRow>(
    `SELECT w.kind, w.message, w.one_spark, w.conversation_id, p.id AS project_id,
            p.name AS project_name
     FROM workflow_runs w
     LEFT JOIN conversation_projects cp ON cp.conversation_id = w.conversation_id
     LEFT JOIN projects p ON p.id = cp.project_id
     WHERE w.id = $1 AND w.workspace_id = $2
     LIMIT 1`,
    [id, deps.workspaceId],
  );
  return rows[0] ?? null;
}

async function usageOf(db: Queryable, conversationId: string | null): Promise<TestRunUsage> {
  const { rows } = await db.query<{ tokens: string; cost: string | null; sources: string[] }>(
    `SELECT COALESCE(sum(COALESCE(r.total_tokens, r.input_tokens + r.output_tokens, 0)), 0)
              AS tokens,
            sum(r.cost_usd) AS cost,
            COALESCE(array_agg(DISTINCT r.cost_source) FILTER (WHERE r.cost_usd IS NOT NULL
              AND r.cost_source IS NOT NULL), '{}') AS sources
     FROM runs r WHERE r.conversation_id = $1`,
    [conversationId],
  );
  const row = rows[0];
  const sources = row?.sources ?? [];
  return {
    totalTokens: Number(row?.tokens ?? 0),
    costUsd: row?.cost == null ? null : Number(row.cost),
    costSource:
      sources.length === 0
        ? null
        : sources.length > 1
          ? 'mixed'
          : sources[0] === 'estimated'
            ? 'estimated'
            : 'reported',
  };
}

async function waitingCards(db: Queryable, conversationId: string | null) {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT a.* FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.status = 'pending' ORDER BY a.created_at`,
    [conversationId],
  );
  return rows.map(toApproval);
}

export async function readTestRun(deps: TestRunDeps, id: string): Promise<WorkflowTestRun> {
  const row = await testRow(deps, id);
  const run = row?.kind === 'test' ? await getWorkflowRun(deps.db, deps.workspaceId, id) : null;
  if (!row || !run) throw new TestRunNotFoundError();
  return {
    run,
    message: row.message,
    projectId: row.project_id,
    projectName: row.project_name,
    oneSpark: row.one_spark,
    held: await heldSendsOf(deps.db, id),
    waiting: await waitingCards(deps.db, row.conversation_id),
    usage: await usageOf(deps.db, row.conversation_id),
  };
}

export async function discardTestRun(deps: TestRunDeps, id: string): Promise<void> {
  const row = await testRow(deps, id);
  if (!row) throw new TestRunNotFoundError();
  if (row.kind !== 'test') throw new BadRequestError(NOT_A_TEST_RUN);
  if (row.conversation_id) await removeChat(deps, row.conversation_id);
  await deps.db.query(`DELETE FROM workflow_runs WHERE id = $1 AND kind = 'test'`, [id]);
}

export async function sweepTestRuns(deps: Omit<TestRunDeps, 'runTarget'>): Promise<number> {
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM workflow_runs WHERE workspace_id = $1 AND kind = 'test'`,
    [deps.workspaceId],
  );
  const full: TestRunDeps = {
    ...deps,
    runTarget: () => Promise.reject(new Error('A sweep starts nothing.')),
  };
  for (const { id } of rows) {
    await discardTestRun(full, id).catch((error: unknown) => {
      console.error(`Could not remove the test run ${id}`, error);
    });
  }
  return rows.length;
}
