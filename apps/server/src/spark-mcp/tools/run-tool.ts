import {
  autonomyLabel,
  type AgentPick,
  type CrewMember,
  type Orchestration,
  type TaskPiece,
} from '@spark-outpost/contracts';
import { toDecision, type DecisionRow } from '../../orchestration/view.ts';
import type { Queryable } from '../../persistence/db.ts';
import { loadOrchestration } from '../../persistence/orchestrations.ts';
import { round } from '../format.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';
import { findTopRun, runLookupInput, type TopRun } from './run-lookup.ts';

const FILES_SHOWN = 10;

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
    ...(member.pieceKey ? { piece: member.pieceKey } : {}),
    ...(member.planStep ? { step: member.planStep } : {}),
    agent: pickLabel(member),
    effort: member.effort,
    status: member.status,
    pickedBy: member.routedBy,
    ...(member.routeNote ? { why: member.routeNote } : {}),
    ...(member.budget ? { budget: member.budget } : {}),
    ...(member.autoWouldUse ? { autoWouldUse: pickLabel(member.autoWouldUse) } : {}),
    ...(member.verdict ? { verdict: member.verdict } : {}),
    ...(member.error ? { error: member.error } : {}),
    costUsd: round(member.costUsd),
    durationMs: member.durationMs,
  };
}

function pieceLine(piece: TaskPiece) {
  return {
    key: piece.key,
    title: piece.title,
    status: piece.status,
    placement: piece.placement,
    builder: piece.builderName,
    agent: pickLabel(piece),
    ...(piece.pickNote ? { jevPick: piece.pickNote } : {}),
    ...(piece.dependsOn.length > 0 ? { dependsOn: piece.dependsOn } : {}),
    owns: piece.owns,
    filesChanged: piece.filesChanged.length,
    ...(piece.filesChanged.length > 0 ? { files: piece.filesChanged.slice(0, FILES_SHOWN) } : {}),
    check: piece.check,
    attempts: piece.attempts,
    ...(piece.violations.length > 0 ? { violations: piece.violations.length } : {}),
    ...(piece.note ? { note: piece.note } : {}),
    costUsd: round(piece.costUsd),
  };
}

function orchestrationView(orchestration: Orchestration) {
  const pending = orchestration.pendingCheckpoint;
  const pieces = orchestration.pieces;
  return {
    phase: orchestration.phase,
    depth: orchestration.depth,
    depthFrom: orchestration.depthSource,
    risk: orchestration.risk,
    modelRouting: orchestration.routing,
    planVersion: orchestration.planVersion,
    retries: orchestration.retries,
    waitingOn: pending ? { kind: pending.kind, title: pending.title } : null,
    budget: orchestration.budget,
    crew: orchestration.crew.map(crewLine),
    pieces: pieces
      ? {
          version: pieces.version,
          status: pieces.status,
          placement: pieces.placement,
          why: pieces.placementReason,
          items: pieces.pieces.map(pieceLine),
        }
      : null,
    totals: {
      runs: orchestration.totals.runs,
      costUsd: round(orchestration.totals.costUsd),
      jevCalls: orchestration.totals.jevCalls,
      jevCostUsd: round(orchestration.totals.jevCostUsd),
    },
  };
}

interface PieceRoute {
  key?: string;
  pick?: AgentPick;
  jevPick?: AgentPick | null;
  rulesPick?: AgentPick | null;
  decidedBy?: string;
  reason?: string;
}

function piecePicks(answer: Record<string, unknown>) {
  const pieces = Array.isArray(answer.pieces) ? (answer.pieces as PieceRoute[]) : [];
  return pieces.map((piece) => ({
    piece: piece.key,
    pick: pickLabel(piece.pick),
    decidedBy: piece.decidedBy,
    reason: piece.reason,
    jevPick: pickLabel(piece.jevPick),
    rulesPick: pickLabel(piece.rulesPick),
  }));
}

function clarifyFields(body: Record<string, unknown>) {
  const questions = Array.isArray(body.questions) ? body.questions : [];
  return {
    round: body.round,
    questions: questions.length,
    answered: body.answered,
    reply: body.reply,
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
    ...(row.purpose === 'piece_route' ? { picks: piecePicks(decision.answer) } : {}),
    ...(row.purpose === 'clarify' ? clarifyFields(row.body) : {}),
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
      agent: pickLabel({ provider: top.provider, model: top.model }),
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
  privateData: true,
  title: 'Run status',
  description:
    "Live status of a chat's latest run (or one run): phase, who is on the crew (Scout, Architect, Builders, Critic) with each agent's model, status, cost and why it was picked, the pieces of a big plan (status, Builder, Jev's per-piece pick and reason, files changed, checks), what it is waiting on, and every Jev decision (intake, routing, piece_route, clarify, verify) with what was applied and why. Defaults to this chat.",
  input: runLookupInput,
  run: async (args, context) => runStatus(context, await findTopRun(context, args)),
});
