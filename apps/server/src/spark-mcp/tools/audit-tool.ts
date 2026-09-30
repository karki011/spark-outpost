import { z } from 'zod';
import type { AuditRunSummary } from '@spark-outpost/contracts';
import { groupBy } from '../../analytics/tally.ts';
import { harnessReport, overviewReport } from '../../analytics/report.ts';
import { conversationAuditRuns, summarizeAudit } from '../../persistence/audit-summary.ts';
import type { Queryable } from '../../persistence/db.ts';
import { loadActivity } from '../../persistence/digests.ts';
import { round } from '../format.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { chatIdFor, chatIdInput, inWorkspace } from './chat-tools.ts';
import { lastDays } from './window.ts';

const STEPS_PER_RUN = 25;
const DECLINED = /^(Declined|Blocked|Refused|Stopped)\b/i;

interface StepRow {
  run_id: string;
  name: string;
}

interface ApprovalRow {
  run_id: string;
  kind: string;
  title: string;
  status: string;
  decided_by: string | null;
  scope: string | null;
}

async function runSteps(db: Queryable, runIds: readonly string[]) {
  const { rows } = await db.query<StepRow>(
    `SELECT run_id, payload->>'stepName' AS name FROM run_events
     WHERE run_id = ANY($1::uuid[]) AND type = 'STEP_STARTED' AND payload ? 'stepName'
     ORDER BY run_id, seq`,
    [runIds],
  );
  return groupBy(rows, (row) => row.run_id);
}

async function runApprovals(db: Queryable, runIds: readonly string[]) {
  const { rows } = await db.query<ApprovalRow>(
    `SELECT run_id, kind, title, status, decided_by, scope FROM approvals
     WHERE run_id = ANY($1::uuid[]) ORDER BY created_at`,
    [runIds],
  );
  return groupBy(rows, (row) => row.run_id);
}

function selectRuns(runs: readonly AuditRunSummary[], runId: string | undefined) {
  if (!runId) return [...runs];
  const picked = runs.filter((run) => run.runId === runId || run.parentRunId === runId);
  if (picked.length === 0) throw new SparkToolError('That run is not in this chat.');
  return picked;
}

async function conversationOfRun(db: Queryable, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.conversation_id ?? null;
}

async function chatAudit(
  { deps, scope }: SparkToolContext,
  chat: string | undefined,
  runId: string | undefined,
) {
  const conversationId = runId
    ? (chat ?? (await conversationOfRun(deps.db, runId)) ?? '')
    : chatIdFor(scope, chat);
  const all = (await inWorkspace(deps.db, scope.workspaceId, conversationId))
    ? await conversationAuditRuns(deps.db, conversationId)
    : null;
  if (!all) throw new SparkToolError('That chat or run does not exist.');
  const runs = selectRuns(all, runId);
  const ids = runs.map((run) => run.runId);
  const [steps, approvals] = await Promise.all([
    runSteps(deps.db, ids),
    runApprovals(deps.db, ids),
  ]);
  const summary = summarizeAudit(conversationId, runs);
  return {
    chat: conversationId,
    ...(runId ? { run: runId } : {}),
    totals: { ...summary.totals, costUsd: round(summary.totals.costUsd) },
    byModel: summary.byModel.map((row) => ({
      provider: row.provider,
      model: row.model,
      runs: row.runs,
      costUsd: round(row.costUsd),
      totalTokens: row.totalTokens,
    })),
    byRole: (summary.byRole ?? []).map((row) => ({
      role: row.role,
      runs: row.runs,
      costUsd: round(row.costUsd),
    })),
    runs: runs.map((run) => {
      const names = (steps.get(run.runId) ?? []).map((step) => step.name);
      const cards = approvals.get(run.runId) ?? [];
      return {
        id: run.runId,
        role: run.role,
        provider: run.provider,
        model: run.model,
        mode: run.mode,
        runMode: run.runMode,
        status: run.status,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        toolCalls: run.toolCallCount,
        costUsd: round(run.costUsd),
        costSource: run.costSource,
        steps: names.slice(0, STEPS_PER_RUN),
        ...(names.length > STEPS_PER_RUN ? { moreSteps: names.length - STEPS_PER_RUN } : {}),
        declined: names.filter((name) => DECLINED.test(name)),
        approvals: cards.map((card) => ({
          kind: card.kind,
          title: card.title,
          status: card.status,
          decidedBy: card.decided_by,
          ...(card.scope ? { scope: card.scope } : {}),
        })),
        approvalWaitMs: run.approvalWaits.reduce(
          (sum, wait) => sum + (wait.end ? Date.parse(wait.end) - Date.parse(wait.start) : 0),
          0,
        ),
        auditLogEntries: run.logEntries,
        ...(run.logPruned ? { logPruned: true } : {}),
      };
    }),
  };
}

async function rangeAudit({ deps, scope }: SparkToolContext, days: number) {
  const window = lastDays(deps, days);
  const since = new Date(Date.parse(`${window.from}T00:00:00Z`) - 86_400_000);
  const [overview, harness, activity] = await Promise.all([
    overviewReport(deps.db, scope.workspaceId, window),
    harnessReport(deps.db, scope.workspaceId, window),
    loadActivity(deps.db, scope.workspaceId, since),
  ]);
  return {
    window: { from: window.from, to: window.to, timeZone: window.timeZone },
    totals: overview.totals,
    health: overview.health,
    approvals: harness.approvals,
    checks: harness.checks,
    loops: harness.loops,
    critic: harness.critic,
    chats: activity
      .toSorted((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        project: chat.project,
        state: chat.state,
        costUsd: round(chat.costUsd),
        filesChanged: chat.filesChanged,
        checks: chat.checks,
        ...(chat.reverted ? { reverted: true } : {}),
        ...(chat.error ? { error: chat.error } : {}),
      })),
  };
}

export const auditTool = sparkTool({
  name: 'spark_audit',
  title: 'Audit',
  description:
    "Audit what agents did. For a chat (default: this chat) or one run: cost, tokens and time per run, model and role, the steps and tool calls each run took, declined actions, and approval cards with who decided them. With days and no chat or run: harness totals, approvals, checks, Critic and loops for that period, plus each active chat's cost and outcome. Use it to review what went right or wrong and how to tune Spark.",
  input: {
    chat: chatIdInput,
    run: z.uuid().optional().describe('One run (and its sub-runs) instead of the whole chat.'),
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe('Audit the whole workspace over the last N days instead of one chat.'),
  },
  run: (args, context) =>
    args.days !== undefined && !args.chat && !args.run
      ? rangeAudit(context, args.days)
      : chatAudit(context, args.chat, args.run),
});
