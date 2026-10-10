import { z } from 'zod';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number(),
});

const noulAnswerSchema = z.object({ type: z.literal('noul'), noul: z.number() });

export const systemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [choiceAnswerSchema, noulAnswerSchema, scoreAnswerSchema]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number().optional() }).optional(),
});
export type SystemOneResponse = z.infer<typeof systemOneResponseSchema>;

const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

export function validNoul(response: SystemOneResponse | null, key: string): number | null {
  const answer = response?.answers[key];
  if (answer?.type !== 'noul' || !unit(answer.noul)) return null;
  return answer.noul;
}

export function validChoice<T extends string>(
  response: SystemOneResponse | null,
  key: string,
  offered: readonly T[],
): { value: T; confidence: number; probabilities: Record<string, number> } | null {
  const answer = response?.answers[key];
  if (answer?.type !== 'choice' || !unit(answer.confidence)) return null;
  if (!Object.values(answer.probabilities).every(unit)) return null;
  const value = offered.find((option) => option === answer.choice);
  return value === undefined
    ? null
    : { value, confidence: answer.confidence, probabilities: answer.probabilities };
}

export interface IntakeQuestions {
  state: Record<string, unknown>;
  questions: Record<string, Record<string, unknown>>;
}

export interface IntakeDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  baseUrl: string;
  timeoutMs?: number;
}
