import {
  feedbackPromptSchema,
  feedbackRatingSchema,
  feedbackReasonSchema,
  outcomeKindSchema,
  outcomeReasonSchema,
  outcomeSignalKindSchema,
  outcomeSignalSourceSchema,
  outcomeVerdictSchema,
  type FeedbackPrompt,
  type OutcomeKind,
  type OutcomeSignal,
  type TurnOutcome,
} from '@spark-outpost/contracts';
import { z } from 'zod';
import { keptContentSchema, type KeptContent } from '../outcomes/commits.ts';
import type { DerivedSignal } from '../outcomes/derive.ts';
import type { OutcomeScore } from '../outcomes/signals.ts';
import type { Queryable } from './db.ts';

export interface OutcomeRow {
  run_id: string;
  task_id: string | null;
  kind: string;
  score: string | null;
  verdict: string;
  reasons: unknown;
  prompt: string | null;
  prompt_decided_at: Date | null;
  rating: string | null;
  rating_reasons: string[];
  comment: string | null;
  rated_at: Date | null;
  kept: unknown;
  commit_checked_at: Date | null;
  settled_at: Date | null;
}

interface SignalRow {
  kind: string;
  polarity: number;
  source: string;
  detail: Record<string, unknown>;
  at: Date;
}

export async function outcomeRow(db: Queryable, runId: string): Promise<OutcomeRow | null> {
  const { rows } = await db.query<OutcomeRow>('SELECT * FROM task_outcomes WHERE run_id = $1', [
    runId,
  ]);
  return rows[0] ?? null;
}

export async function ensureOutcomeRow(
  db: Queryable,
  runId: string,
  taskId: string | null,
  kind: OutcomeKind,
): Promise<void> {
  await db.query(
    `INSERT INTO task_outcomes (run_id, task_id, kind) VALUES ($1, $2, $3)
     ON CONFLICT (run_id) DO UPDATE SET task_id = EXCLUDED.task_id, kind = EXCLUDED.kind,
       updated_at = CASE
         WHEN task_outcomes.kind IS DISTINCT FROM EXCLUDED.kind
           OR task_outcomes.task_id IS DISTINCT FROM EXCLUDED.task_id THEN now()
         ELSE task_outcomes.updated_at END`,
    [runId, taskId, kind],
  );
}

export async function saveKeptContent(
  db: Queryable,
  runId: string,
  taskId: string | null,
  kept: KeptContent,
): Promise<void> {
  await db.query(
    `INSERT INTO task_outcomes (run_id, task_id, kept) VALUES ($1, $2, $3)
     ON CONFLICT (run_id) DO UPDATE SET kept = EXCLUDED.kept, updated_at = now()
     WHERE task_outcomes.kept IS NULL`,
    [runId, taskId, JSON.stringify(kept)],
  );
}

export function keptOf(row: OutcomeRow): KeptContent | null {
  const parsed = keptContentSchema.safeParse(row.kept);
  return parsed.success ? parsed.data : null;
}

export async function insertSignals(
  db: Queryable,
  runId: string,
  signals: readonly DerivedSignal[],
): Promise<void> {
  for (const signal of signals) {
    await db.query(
      `INSERT INTO outcome_signals (run_id, kind, polarity, source, detail, at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (run_id, kind) DO NOTHING`,
      [
        runId,
        signal.kind,
        signal.polarity,
        signal.source,
        JSON.stringify(signal.detail),
        signal.at,
      ],
    );
  }
}

export async function outcomeSignals(db: Queryable, runId: string): Promise<OutcomeSignal[]> {
  const { rows } = await db.query<SignalRow>(
    `SELECT kind, polarity, source, detail, at FROM outcome_signals
     WHERE run_id = $1 ORDER BY at, kind`,
    [runId],
  );
  return rows.map((row) => ({
    kind: outcomeSignalKindSchema.parse(row.kind),
    polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]).parse(row.polarity),
    source: outcomeSignalSourceSchema.parse(row.source),
    detail: row.detail,
    at: row.at.toISOString(),
  }));
}

export async function saveScore(db: Queryable, runId: string, score: OutcomeScore) {
  await db.query(
    `UPDATE task_outcomes SET score = $2, verdict = $3, reasons = $4, updated_at = now()
     WHERE run_id = $1 AND (score IS DISTINCT FROM $2::numeric OR verdict <> $3
       OR reasons <> $4::jsonb)`,
    [runId, score.score, score.verdict, JSON.stringify(score.reasons)],
  );
}

export async function askedInTask(db: Queryable, runId: string, taskId: string | null) {
  if (!taskId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM task_outcomes
     WHERE task_id = $1 AND run_id <> $2 AND (prompt IS NOT NULL OR rating IS NOT NULL)
     LIMIT 1`,
    [taskId, runId],
  );
  return rows.length > 0;
}

export interface TurnPlace {
  turnNumber: number;
  askedRecently: boolean;
}

export async function turnPlace(
  db: Queryable,
  runId: string,
  lookBack: number,
): Promise<TurnPlace> {
  const { rows } = await db.query<{ asked: boolean; turns: string }>(
    `SELECT (o.prompt IS NOT NULL OR o.rating IS NOT NULL) AS asked, count(*) OVER () AS turns
     FROM runs r
     JOIN runs cur ON cur.id = $1
     LEFT JOIN task_outcomes o ON o.run_id = r.id
     WHERE r.conversation_id = cur.conversation_id AND r.parent_run_id IS NULL
       AND r.role IS DISTINCT FROM 'digest'
       AND (r.created_at, r.id) <= (cur.created_at, cur.id)
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $2`,
    [runId, lookBack + 1],
  );
  return {
    turnNumber: Number(rows[0]?.turns ?? 0),
    askedRecently: rows.slice(1).some((row) => row.asked),
  };
}

export async function decidePrompt(
  db: Queryable,
  runId: string,
  prompt: FeedbackPrompt | null,
): Promise<void> {
  await db.query(
    `UPDATE task_outcomes SET prompt = $2, prompt_decided_at = now(), updated_at = now()
     WHERE run_id = $1 AND prompt_decided_at IS NULL`,
    [runId, prompt],
  );
}

export async function markCommitChecked(db: Queryable, runId: string, at: Date): Promise<void> {
  await db.query('UPDATE task_outcomes SET commit_checked_at = $2 WHERE run_id = $1', [runId, at]);
}

export async function markSettled(db: Queryable, runId: string): Promise<void> {
  await db.query(
    'UPDATE task_outcomes SET settled_at = now() WHERE run_id = $1 AND settled_at IS NULL',
    [runId],
  );
}

export interface FeedbackInput {
  rating: 'up' | 'down';
  reasons: readonly string[];
  comment: string | null;
}

export async function saveFeedback(
  db: Queryable,
  runId: string,
  feedback: FeedbackInput,
): Promise<void> {
  await db.query(
    `UPDATE task_outcomes SET rating = $2, rating_reasons = $3, comment = $4,
       rated_at = now(), updated_at = now()
     WHERE run_id = $1`,
    [runId, feedback.rating, feedback.reasons, feedback.comment],
  );
}

export function toTurnOutcome(row: OutcomeRow, signals: OutcomeSignal[]): TurnOutcome {
  const rating = feedbackRatingSchema.nullable().parse(row.rating);
  return {
    runId: row.run_id,
    taskId: row.task_id,
    kind: outcomeKindSchema.parse(row.kind),
    score: row.score === null ? null : Number(row.score),
    verdict: outcomeVerdictSchema.parse(row.verdict),
    reasons: z.array(outcomeReasonSchema).parse(row.reasons),
    prompt: feedbackPromptSchema.nullable().parse(row.prompt),
    feedback:
      rating && row.rated_at
        ? {
            rating,
            reasons: z.array(feedbackReasonSchema).parse(row.rating_reasons),
            comment: row.comment,
            at: row.rated_at.toISOString(),
          }
        : null,
    signals,
  };
}
