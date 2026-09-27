import type { SystemOneResponse } from './intake-questions.ts';

export type ChoiceIssue =
  | 'missing-answer'
  | 'unexpected-answer-type'
  | 'unknown-choice'
  | 'invalid-confidence'
  | 'distribution-keys'
  | 'distribution-sum'
  | 'distribution-argmax';

export interface ChoiceDistribution {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

const ROUNDING_PER_OPTION = 0.005;
const EPSILON = 1e-9;

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function fullDistribution(
  reported: Record<string, number>,
  offered: readonly string[],
): Record<string, number> | 'distribution-keys' {
  const allowed = new Set(offered);
  for (const [id, probability] of Object.entries(reported)) {
    if (!allowed.has(id) || !isProbability(probability)) return 'distribution-keys';
  }
  return Object.fromEntries(
    offered.map((id) => [id, Object.hasOwn(reported, id) ? reported[id]! : 0]),
  );
}

export function readChoice(
  response: SystemOneResponse,
  key: string,
  offered: readonly string[],
): ChoiceDistribution | ChoiceIssue {
  const answer = response.answers[key];
  if (!answer) return 'missing-answer';
  if (answer.type !== 'choice') return 'unexpected-answer-type';
  if (!offered.includes(answer.choice)) return 'unknown-choice';
  if (!isProbability(answer.confidence)) return 'invalid-confidence';
  const probabilities = fullDistribution(answer.probabilities, offered);
  if (typeof probabilities === 'string') return probabilities;
  const values = Object.values(probabilities);
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > ROUNDING_PER_OPTION * offered.length + EPSILON) {
    return 'distribution-sum';
  }
  if (probabilities[answer.choice]! + EPSILON < Math.max(...values)) return 'distribution-argmax';
  return { choice: answer.choice, confidence: answer.confidence, probabilities };
}

export function byProbability(probabilities: Record<string, number>): [string, number][] {
  return Object.entries(probabilities)
    .filter(([, probability]) => probability > 0)
    .sort(([a, pa], [b, pb]) => pb - pa || a.localeCompare(b));
}
