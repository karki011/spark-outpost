import { POLICY_VERSION } from '../advisor/policy.ts';
import { cardFor } from '../model-cards/cards.ts';
import type { Queryable } from '../persistence/db.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { builderFacts } from '../orchestration/member-routes.ts';
import { trajectoryUsd } from '../orchestration/route-score.ts';
import { chatPick } from '../orchestration/routing.ts';
import type { Session } from '../orchestration/session.ts';
import { taskSignals, type TaskSignals } from '../orchestration/task-signals.ts';
import { taskKind } from './task-kind.ts';
import { estimateTask, type PastRun, type TaskEstimate, type TaskKey } from './estimate.ts';

const HISTORY_LIMIT = 300;

interface EstimateRow {
  answer: {
    kind?: unknown;
    size?: unknown;
    model?: unknown;
    base?: { minutes?: { typical?: unknown }; usd?: { typical?: unknown } };
  };
  active_ms: number;
  cost_usd: string | null;
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pastRun(row: EstimateRow): PastRun | null {
  const { answer } = row;
  const size = numberOr(answer.size);
  if (typeof answer.kind !== 'string' || size === null) return null;
  return {
    kind: answer.kind,
    size,
    model: typeof answer.model === 'string' ? answer.model : null,
    minutes: row.active_ms / 60_000,
    usd: Number(row.cost_usd ?? 0),
    baseMinutes: numberOr(answer.base?.minutes?.typical),
    baseUsd: numberOr(answer.base?.usd?.typical),
  };
}

export async function pastRuns(
  db: Queryable,
  workspaceId: string,
  excludeRunId: string | null = null,
): Promise<PastRun[]> {
  const { rows } = await db.query<EstimateRow>(
    `SELECT a.body->'answer' AS answer, o.active_ms,
       (SELECT COALESCE(SUM(x.cost_usd), 0) FROM runs x WHERE x.id = r.id OR x.parent_run_id = r.id)
         AS cost_usd
     FROM run_advice a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     JOIN orchestrations o ON o.run_id = r.id
     WHERE c.workspace_id = $1 AND a.purpose = 'law' AND a.body->'answer'->>'law' = 'estimate'
       AND r.status = 'succeeded' AND r.id IS DISTINCT FROM $2::uuid
       AND EXISTS (SELECT 1 FROM runs b WHERE b.parent_run_id = r.id AND b.role = 'builder')
     ORDER BY r.created_at DESC LIMIT ${HISTORY_LIMIT}`,
    [workspaceId, excludeRunId],
  );
  return rows.map(pastRun).filter((run): run is PastRun => run !== null);
}

export function sessionSignals(s: Session): TaskSignals {
  const facts = builderFacts(s);
  return taskSignals({ ...facts, complex: facts.complex ?? null }, facts.ratings);
}

function roughUsd(s: Session, signals: TaskSignals): number | null {
  const chat = chatPick(s.route);
  const card = cardFor({ id: chat.model ?? '', label: chat.modelLabel }, chat.provider);
  return card ? trajectoryUsd(card, signals) : null;
}

async function recordEstimate(s: Session, estimate: TaskEstimate): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'law',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: estimate.text,
      applied: 'rules',
      gate: null,
      jevError: null,
      latencyMs: null,
      answer: { law: 'estimate', ...estimate },
    },
  });
}

export async function ensureEstimate(s: Session): Promise<TaskEstimate | null> {
  if (s.estimate !== undefined) return s.estimate;
  s.estimate = null;
  try {
    const signals = sessionSignals(s);
    const key: TaskKey = {
      kind: taskKind(s),
      size: signals.complexity.value,
      model: s.route.chat.model,
    };
    const history = await pastRuns(s.deps.db, s.input.workspaceId, s.lease.runId);
    s.estimate = estimateTask(key, history, roughUsd(s, signals));
    await recordEstimate(s, s.estimate);
  } catch (error) {
    console.error('Could not estimate the task', error);
  }
  return s.estimate;
}
