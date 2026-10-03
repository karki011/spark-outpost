import { createHash } from 'node:crypto';
import {
  systemOneResponseSchema,
  type IntakeQuestions,
  type SystemOneResponse,
} from '../advisor/intake-questions.ts';
import { redactValue } from '../audit/redact.ts';
import type { Queryable } from '../persistence/db.ts';

export const ANSWER_CACHE_VERSION = 'jev-answer-cache-1';
export const ANSWER_CACHE_TTL_DAYS = 7;

export interface CachedAnswers {
  answers: SystemOneResponse['answers'];
  model: string;
}

const answersSchema = systemOneResponseSchema.shape.answers;

export function answerCacheKey(
  policyVersion: string,
  model: string,
  asked: IntakeQuestions,
): string {
  const request = JSON.stringify([ANSWER_CACHE_VERSION, policyVersion, model, redactValue(asked)]);
  return createHash('sha256').update(request).digest('hex');
}

function answersFor(asked: IntakeQuestions, stored: unknown): CachedAnswers['answers'] | null {
  const parsed = answersSchema.safeParse(stored);
  if (!parsed.success) return null;
  const wanted = Object.keys(asked.questions);
  return wanted.every((key) => parsed.data[key] !== undefined) ? parsed.data : null;
}

export async function cachedAnswers(
  db: Queryable,
  key: string,
  asked: IntakeQuestions,
): Promise<CachedAnswers | null> {
  const { rows } = await db.query<{ answers: unknown; model: string }>(
    `SELECT answers, model FROM jev_answer_cache
     WHERE key = $1 AND created_at > now() - make_interval(days => $2)`,
    [key, ANSWER_CACHE_TTL_DAYS],
  );
  const row = rows[0];
  if (!row) return null;
  const answers = answersFor(asked, row.answers);
  return answers ? { answers, model: row.model } : null;
}

export async function storeAnswers(
  db: Queryable,
  key: string,
  response: SystemOneResponse,
): Promise<void> {
  await db.query(
    `INSERT INTO jev_answer_cache (key, answers, model) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET answers = EXCLUDED.answers, model = EXCLUDED.model,
       created_at = now()`,
    [key, JSON.stringify(response.answers), response.model],
  );
  await db.query(
    'DELETE FROM jev_answer_cache WHERE created_at <= now() - make_interval(days => $1)',
    [ANSWER_CACHE_TTL_DAYS],
  );
}
