import type { PlanDocument, RunFileChanges, TaskDetail } from '@spark-outpost/contracts';
import { agreedPlans } from '../../plans/agreed-plans.ts';
import type { Queryable } from '../../persistence/db.ts';
import { getTaskDetail } from '../../persistence/task-views.ts';
import { taskChanges } from '../../projects/task-changes.ts';
import { round } from '../format.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { findTopRun, runLookupInput } from './run-lookup.ts';

const PLAN_CHARS = 6_000;

async function latestTaskId(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

function currentPlan(task: TaskDetail) {
  const latest = task.planVersions.at(-1);
  if (!latest) return null;
  return {
    version: latest.version,
    of: task.planVersions.length,
    steps: latest.body.entries.map((entry) => ({ step: entry.content, status: entry.status })),
  };
}

function planBody(plan: PlanDocument): string {
  return plan.body.length > PLAN_CHARS
    ? `${plan.body.slice(0, PLAN_CHARS)}… (${plan.body.length} chars)`
    : plan.body;
}

function agreedPlan(documents: readonly PlanDocument[], staleFiles: readonly string[]) {
  const approved = documents.findLast((document) => document.status === 'approved');
  if (!approved) return null;
  return {
    version: approved.version,
    status: approved.status,
    source: approved.source,
    approvedBy: approved.approvedBy,
    approvedAt: approved.approvedAt,
    versions: documents.length,
    ...(staleFiles.length > 0 ? { changedSinceAgreed: staleFiles } : {}),
    body: planBody(approved),
  };
}

function proposedPlan(documents: readonly PlanDocument[]) {
  const latest = documents.at(-1);
  if (latest?.status !== 'proposed') return {};
  return {
    proposedPlan: {
      version: latest.version,
      status: latest.status,
      source: latest.source,
      body: planBody(latest),
    },
  };
}

function runFiles(run: RunFileChanges) {
  return {
    run: run.runId,
    ...(run.name ? { agent: run.name } : {}),
    ...(run.revertedAt ? { revertedAt: run.revertedAt } : {}),
    files: run.files.map((file) => ({
      path: file.path,
      change: file.change,
      ...(file.oldPath ? { from: file.oldPath } : {}),
      added: file.added,
      removed: file.removed,
    })),
  };
}

async function changes(context: SparkToolContext, taskId: string) {
  try {
    const found = await taskChanges(context.deps.db, context.scope.workspaceId, taskId);
    const files = found.runs.flatMap((run) => run.files);
    return {
      files: files.length,
      added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
      removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
      byRun: found.runs.map(runFiles),
    };
  } catch (error) {
    return { unavailable: (error as Error).message };
  }
}

async function taskView(
  context: SparkToolContext,
  args: { chat?: string | undefined; run?: string | undefined },
) {
  const top = await findTopRun(context, args);
  const { db } = context.deps;
  const taskId = top.task_id ?? (await latestTaskId(db, top.conversation_id));
  const task = taskId ? await getTaskDetail(db, taskId) : null;
  if (!task) throw new SparkToolError('This chat has no task yet: nothing was planned or changed.');
  const [agreed, changed] = await Promise.all([
    agreedPlans(db, task.conversationId),
    changes(context, task.id),
  ]);
  return {
    chat: { id: top.conversation_id, title: top.chat_title },
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      progress: task.summary.text,
      costUsd: round(task.costUsd),
    },
    plan: currentPlan(task),
    agreedPlan: agreedPlan(agreed.documents, agreed.staleFiles),
    ...proposedPlan(agreed.documents),
    checklist: [...task.todo, ...task.recorded].map((item) => ({
      item: item.label,
      state: item.state,
    })),
    filesChanged: changed,
    links: task.links.map((link) => ({ kind: link.kind, url: link.url, title: link.title })),
  };
}

export const taskTool = sparkTool({
  name: 'spark_task',
  title: 'Task, plan and changes',
  description:
    "The task behind a chat (default: this chat's latest): its current plan version and steps, the agreed plan document (version, who approved it, files changed since) or a plan proposed and not approved, the checklist, every file changed per run (path, added/modified/deleted, lines added and removed, whether the run was reverted; never file contents) and linked PRs.",
  input: runLookupInput,
  run: (args, context) => taskView(context, args),
});
