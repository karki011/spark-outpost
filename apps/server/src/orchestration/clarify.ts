import {
  CHECKPOINT_OPTION,
  categorySchema,
  checkpointPayloadSchema,
  clarifyOptionId,
  type Category,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { asksWhenUnsure } from '../advisor/gate.ts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import type { CheckpointCard } from './checkpoint.ts';

export const INTERPRETATION_QUESTION = 'What should change?';
export const MIN_INTERPRETATIONS = 2;
export const MAX_INTERPRETATIONS = 4;
const LIKELY_ENOUGH = 0.1;
const SHORT_REQUEST_WORDS = 10;

const INTERPRETATIONS: Partial<Record<Category, string>> = {
  bug_fix: 'Fix what is broken in it',
  debugging: 'Find the cause of a problem in it',
  feature: 'Add new behaviour or features',
  refactor: 'Restructure the code without changing what it does',
  docs: 'Improve its documentation',
  review: 'Review it and suggest improvements, without changing it',
  setup: 'Change its build, tooling or settings',
  research: 'Explain how it works, without changing it',
  question: 'Explain how it works, without changing it',
};

const FALLBACK_INTERPRETATIONS = [INTERPRETATIONS.feature!, INTERPRETATIONS.refactor!];

const VAGUE_GOAL =
  /\b(?:better|improve|improved|nicer|cleaner|clean up|tidy|polish|enhance|optimi[sz]e|modernise|modernize|fix it|sort out)\b/i;

function words(request: string): number {
  return request.trim().split(/\s+/).filter(Boolean).length;
}

export function vagueByRule(request: string, namedFiles: number): boolean {
  if (namedFiles > 0) return false;
  return words(request) <= SHORT_REQUEST_WORDS && VAGUE_GOAL.test(request);
}

export type VagueHandling = 'ask' | 'assume';

export function vagueHandling(level: InvolvementLevel): VagueHandling {
  return asksWhenUnsure(level) ? 'ask' : 'assume';
}

function rankedCategories(response: SystemOneResponse | null): [Category, number][] {
  const answer = response?.answers.intent;
  if (answer?.type !== 'choice') return [];
  return Object.entries(answer.probabilities)
    .flatMap(([id, probability]): [Category, number][] => {
      const category = categorySchema.safeParse(id);
      return category.success ? [[category.data, probability]] : [];
    })
    .sort(([, a], [, b]) => b - a);
}

export function interpretations(response: SystemOneResponse | null): string[] {
  const ranked = rankedCategories(response).flatMap(([category, probability]) => {
    const text = INTERPRETATIONS[category];
    return text ? [{ text, probability }] : [];
  });
  const unique = [...new Map(ranked.map((entry) => [entry.text, entry])).values()];
  const likely = unique.filter(
    (entry, index) => index < MIN_INTERPRETATIONS || entry.probability >= LIKELY_ENOUGH,
  );
  const texts = likely.slice(0, MAX_INTERPRETATIONS).map((entry) => entry.text);
  for (const fallback of FALLBACK_INTERPRETATIONS) {
    if (texts.length >= MIN_INTERPRETATIONS) break;
    if (!texts.includes(fallback)) texts.push(fallback);
  }
  return texts;
}

export function interpretationCard(choices: readonly string[], reason: string): CheckpointCard {
  const payload = checkpointPayloadSchema.parse({
    kind: 'clarify',
    question: INTERPRETATION_QUESTION,
    reason,
    choices: [...choices],
  });
  return {
    kind: 'clarify',
    title: INTERPRETATION_QUESTION,
    payload,
    options: [
      ...choices.map((choice, index) => ({
        optionId: clarifyOptionId(index),
        name: choice,
        kind: 'allow_once' as const,
      })),
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      {
        optionId: CHECKPOINT_OPTION.clarifyRules,
        name: 'Go with the most likely',
        kind: 'allow_once',
      },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export type Interpretation =
  { type: 'chosen'; text: string } | { type: 'assumed'; text: string } | { type: 'stopped' };

export function chosenInterpretation(
  card: CheckpointCard,
  optionId: string,
  note: string | null,
): Interpretation {
  if (optionId === CHECKPOINT_OPTION.stop) return { type: 'stopped' };
  const likely = card.payload.choices?.[0] ?? '';
  if (optionId === CHECKPOINT_OPTION.answer && note?.trim()) {
    return { type: 'chosen', text: note.trim() };
  }
  const index = card.options.findIndex((option) => option.optionId === optionId);
  const picked = card.payload.choices?.[index];
  return picked ? { type: 'chosen', text: picked } : { type: 'assumed', text: likely };
}

export function assumedRequest(request: string, interpretation: string): string {
  return `${request}\n\nThe request was vague, so assume the user means: ${interpretation}`;
}

export function assumptionLine(interpretation: string): string {
  return `Assumed you meant: ${interpretation}. Say so if you meant something else.`;
}
