import type { AdvisorOption } from './advice.ts';

export type Description = string | Record<string, unknown> | unknown[];

export type NoulCriteria = {
  true: Description;
  false: Description;
};

export type NoulQuestion = {
  type: 'noul';
  instructions: Description;
  criteria: NoulCriteria;
};

export function noulQuestion(instructions: Description, criteria: NoulCriteria): NoulQuestion {
  return { type: 'noul', instructions, criteria: { true: criteria.true, false: criteria.false } };
}

const EFFORT_SITUATIONS = [
  'Nothing to work out: a lookup, a one-line edit, or a direct answer',
  'Routine work with an obvious approach: a small, well-understood change',
  'Ordinary work with a few decisions: a focused feature, or a fix that needs some investigation',
  'Involved work: several connected changes, or logic that is easy to get subtly wrong',
  'Hard work: design across many files, a subtle bug, or a risky change that must be right first time',
  'Open-ended work: several approaches must be weighed and a mistake is costly',
];

const SITUATIONS_FOR_COUNT: Record<number, readonly number[]> = {
  2: [1, 4],
  3: [1, 2, 4],
  4: [1, 2, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

function situationIndex(position: number, count: number): number {
  const picked = SITUATIONS_FOR_COUNT[count]?.[position];
  if (picked !== undefined) return picked;
  return Math.round((position * (EFFORT_SITUATIONS.length - 1)) / Math.max(1, count - 1));
}

export function effortLevels(efforts: readonly AdvisorOption[]): Record<string, string>[] {
  return efforts.map((effort, position) => ({
    effort: effort.label,
    when: EFFORT_SITUATIONS[situationIndex(position, efforts.length)]!,
    ...(effort.description ? { note: effort.description } : {}),
  }));
}
