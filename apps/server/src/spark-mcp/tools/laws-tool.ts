import {
  LAW_BUDGET_SHARE,
  LAW_DEMOTE_FLOOR,
  LAW_DEMOTE_MARGIN,
  LAW_DEMOTE_MIN_RUNS,
  LAW_DEMOTE_WINDOW,
  LAW_ESTIMATE_MIN_RUNS,
  LAW_PAD_MAX,
} from '../../advisor/policy.ts';
import { demotionText, type Demotion } from '../../laws/demotion.ts';
import { loadDemotions } from '../../laws/demotion-history.ts';
import { quantile, type PastRun } from '../../laws/estimate.ts';
import { pastRuns } from '../../laws/estimate-history.ts';
import type { Queryable } from '../../persistence/db.ts';
import { round } from '../format.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { findTopRun, runLookupInput } from './run-lookup.ts';

interface LawRow {
  answer: Record<string, unknown>;
  summary: string;
}

async function runLaws(db: Queryable, runId: string) {
  const { rows } = await db.query<LawRow>(
    `SELECT body->'answer' AS answer, body->>'summary' AS summary FROM run_advice
     WHERE run_id = $1 AND purpose = 'law' ORDER BY created_at`,
    [runId],
  );
  const latest = (law: string) => rows.findLast((row) => row.answer.law === law);
  const estimate = latest('estimate');
  const budget = latest('budget');
  const findings = latest('findings');
  return {
    estimate: estimate
      ? {
          text: estimate.summary,
          source: estimate.answer.source,
          kind: estimate.answer.kind,
          size: estimate.answer.size,
          similarRuns: estimate.answer.runs,
        }
      : null,
    budget: budget
      ? {
          text: budget.summary,
          toolCalls: budget.answer.toolCalls,
          activeMs: budget.answer.activeMs,
          complexity: budget.answer.complexity,
          ratedBy: budget.answer.source,
        }
      : null,
    findings: findings
      ? { removalsBy: findings.answer.removalsBy, items: findings.answer.findings }
      : null,
  };
}

function groupKey(run: PastRun): string {
  return `${run.kind} · complexity ${run.size} · ${run.model ?? 'default model'}`;
}

function estimateGroups(history: readonly PastRun[]) {
  const groups = new Map<string, PastRun[]>();
  for (const run of history) groups.set(groupKey(run), [...(groups.get(groupKey(run)) ?? []), run]);
  return [...groups].map(([group, runs]) => ({
    group,
    runs: runs.length,
    typicalMinutes: round(
      quantile(
        runs.map((run) => run.minutes),
        0.5,
      ),
    ),
    typicalUsd: round(
      quantile(
        runs.map((run) => run.usd),
        0.5,
      ),
    ),
    learned: runs.length >= LAW_ESTIMATE_MIN_RUNS,
  }));
}

function demotionLine(demotion: Demotion) {
  return {
    model: demotion.label,
    provider: demotion.provider,
    kind: demotion.kind,
    passRate: round(demotion.rate),
    passed: demotion.passed,
    runs: demotion.runs,
    peersPassRate: demotion.peers ? round(demotion.peers.rate) : null,
    text: demotionText(demotion),
  };
}

async function currentRun(
  context: SparkToolContext,
  args: { chat?: string | undefined; run?: string | undefined },
) {
  try {
    const top = await findTopRun(context, args);
    return { id: top.id, ...(await runLaws(context.deps.db, top.id)) };
  } catch (error) {
    if (error instanceof SparkToolError && !args.run) return null;
    throw error;
  }
}

export const lawsTool = sparkTool({
  name: 'spark_laws',
  privateData: true,
  title: 'Universal laws',
  description:
    "Spark's guardrails on Builders: a run's time and cost estimate (learned from this workspace's history, or a rough rule estimate), the Builder's turn budget scaled to the task's complexity, and the findings on its change (unexplained removals, checks Spark re-ran that contradict the Builder, weakened tests, config and out-of-scope edits); plus the estimate history by task kind, size and model, and models demoted for a task kind because their recent pass rate fell below their tier peers. Defaults to this chat's latest run.",
  input: runLookupInput,
  run: async (args, context) => {
    const { db } = context.deps;
    const { workspaceId } = context.scope;
    const [run, history, demoted] = await Promise.all([
      currentRun(context, args),
      pastRuns(db, workspaceId),
      loadDemotions(db, workspaceId),
    ]);
    return {
      run,
      estimates: estimateGroups(history),
      demotions: demoted.map(demotionLine),
      thresholds: {
        estimateFromRuns: LAW_ESTIMATE_MIN_RUNS,
        paddingMax: LAW_PAD_MAX,
        budgetShareByComplexity: LAW_BUDGET_SHARE,
        demoteWindow: LAW_DEMOTE_WINDOW,
        demoteMinRuns: LAW_DEMOTE_MIN_RUNS,
        demoteMargin: LAW_DEMOTE_MARGIN,
        demoteFloorWithoutPeers: LAW_DEMOTE_FLOOR,
      },
    };
  },
});
