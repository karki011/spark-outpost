import { autonomyLabel, type CrewMember, type Orchestration } from '@spark-outpost/contracts';
import { toDecision, type DecisionRow } from '../../orchestration/view.ts';
import type { Queryable } from '../../persistence/db.ts';
import { loadOrchestration } from '../../persistence/orchestrations.ts';
import { round } from '../format.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';
import { findTopRun, runLookupInput, type TopRun } from './run-lookup.ts';
import { reportedModel } from '../../providers/reported-model.ts';

interface PickLike {
  provider?: string | null | undefined;
  model?: string | null | undefined;
  modelLabel?: string | null | undefined;
}

function pickLabel(pick: PickLike | null | undefined): string | null {
  if (!pick?.provider) return null;
  const model = pick.modelLabel ?? pick.model;
  return model ? `${pick.provider} · ${model}` : pick.provider;
}

function crewLine(member: CrewMember) {
  return {
    name: member.name,
    role: member.role,
    agent: pickLabel(member),
    effort: member.effort,
    status: member.status,
    ...(member.error ? { error: member.error } : {}),
    costUsd: round(member.costUsd),
    durationMs: member.durationMs,
  };
}

function orchestrationView(orchestration: Orchestration) {
  const pending = orchestration.pendingCheckpoint;
  return {
    phase: orchestration.phase,
    waitingOn: pending ? { kind: pending.kind, title: pending.title } : null,
    ...(orchestration.usage ? { usage: orchestration.usage } : {}),
    crew: orchestration.crew.map(crewLine),
    totals: {
      runs: orchestration.totals.runs,
      costUsd: round(orchestration.totals.costUsd),
      jevCalls: orchestration.totals.jevCalls,
      jevCostUsd: round(orchestration.totals.jevCostUsd),
    },
  };
}

interface AdviceRow extends Omit<DecisionRow, 'purpose'> {
  purpose: string;
}

function decisionLine(row: AdviceRow) {
  const decision = toDecision(row as DecisionRow);
  return {
    kind: row.purpose,
    ...(row.role ? { role: row.role } : {}),
    at: decision.createdAt,
    jev: decision.jevStatus,
    applied: decision.applied,
    ...(decision.summary ? { summary: decision.summary } : {}),
    ...(decision.gate ? { gate: decision.gate.decision } : {}),
    ...(decision.jevError ? { jevError: decision.jevError } : {}),
    costUsd: round(decision.costUsd),
  };
}

async function decisions(db: Queryable, runId: string) {
  const { rows } = await db.query<AdviceRow>(
    'SELECT * FROM run_advice WHERE run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map(decisionLine);
}

interface OutcomeRow {
  verdict: string;
  rating: string | null;
  rating_reasons: string[];
}

async function outcome(db: Queryable, runId: string) {
  const { rows } = await db.query<OutcomeRow>(
    'SELECT verdict, rating, rating_reasons FROM task_outcomes WHERE run_id = $1',
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return { verdict: row.verdict, rating: row.rating, ratingReasons: row.rating_reasons };
}

async function runStatus(context: SparkToolContext, top: TopRun) {
  const { db } = context.deps;
  const [orchestration, decided, result] = await Promise.all([
    loadOrchestration(db, top.id),
    decisions(db, top.id),
    outcome(db, top.id),
  ]);
  return {
    chat: { id: top.conversation_id, title: top.chat_title },
    run: {
      id: top.id,
      status: top.status,
      agent: pickLabel({ provider: top.provider, ...reportedModel(top.provider, top.model) }),
      mode: top.mode,
      autonomy: top.level ? autonomyLabel(top.level) : null,
      startedAt: top.created_at.toISOString(),
      ...(top.error ? { error: top.error } : {}),
    },
    crew: orchestration ? orchestrationView(orchestration) : null,
    jevDecisions: decided,
    outcome: result,
  };
}

export const runTool = sparkTool({
  name: 'spark_run',
  title: 'Run status',
  description:
    "Live status of a chat's latest run (or one run): the agent, its mode, status and error, what it is waiting on, any Spark that was handed a job (model, status, cost), the totals, Jev's stored decisions and the outcome. Defaults to this chat.",
  input: runLookupInput,
  run: async (args, context) => runStatus(context, await findTopRun(context, args)),
});
