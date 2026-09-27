import { optionConfidence } from '../advisor/gate.ts';
import { noulQuestion } from '../advisor/questions.ts';
import {
  MAX_TASK_CHARACTERS,
  type IntakeQuestions,
  type SystemOneResponse,
} from '../advisor/intake-questions.ts';
import { STEP_CHARACTERS } from './jev-questions.ts';
import { isResearchStep, planGroups, worthItsOwnBuilder, worthSplitting } from './parallel.ts';
import { stepFiles } from './step-files.ts';

export const NOUL_CERTAINTY = 0.5;
export const INDEPENDENT_QUESTION = 'These steps can be done independently';
export const LARGE_QUESTION = 'This step is large (≥20s of work)';

export interface NoulVerdict {
  noul: number;
  confidence: number;
  value: boolean | null;
}

export interface ParallelVerdicts {
  independent: (NoulVerdict | null)[];
  large: (NoulVerdict | null)[];
}

export type ChoiceSource = 'jev' | 'rules';

export interface PairDecision {
  steps: [number, number];
  rules: boolean;
  jev: NoulVerdict | null;
  independent: boolean;
  source: ChoiceSource;
}

export interface SizeDecision {
  step: number;
  rules: boolean;
  jev: NoulVerdict | null;
  large: boolean;
  source: ChoiceSource;
}

export interface GroupDecision {
  steps: number[];
  parallel: boolean;
  rules: boolean;
  source: ChoiceSource;
}

export interface ParallelChoice {
  groups: number[][];
  rulesGroups: number[][];
  pairs: PairDecision[];
  sizes: SizeDecision[];
  decided: GroupDecision[];
}

export function noulConfidence(noul: number): number {
  return optionConfidence(Math.max(noul, 1 - noul), 2);
}

export function noulVerdict(noul: number): NoulVerdict {
  const confidence = noulConfidence(noul);
  return { noul, confidence, value: confidence >= NOUL_CERTAINTY ? noul >= 0.5 : null };
}

const independentKey = (index: number) => `independent_${index + 1}`;
const largeKey = (index: number) => `large_${index + 1}`;

export function buildParallelQuestions(task: string, steps: readonly string[]): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  steps.forEach((_, index) => {
    if (index + 1 < steps.length) {
      questions[independentKey(index)] = noulQuestion(
        `${INDEPENDENT_QUESTION}: \`steps.${index + 1}\` and \`steps.${index + 2}\` of \`task\`. Independent means neither needs the other's result and they do not change the same files, so two agents could do them at the same time.`,
        {
          true: 'Two agents could do them at the same time without waiting for each other',
          false: 'One needs the other’s result, or both change the same files',
        },
      );
    }
    questions[largeKey(index)] = noulQuestion(
      `${LARGE_QUESTION}: \`steps.${index + 1}\` of \`task\`. Large means a coding agent needs about 20 seconds or more to do it, for example editing several files or writing tests.`,
      {
        true: 'It takes a coding agent 20 seconds or more',
        false: 'It is a quick edit of a few lines',
      },
    );
  });
  const state = {
    task: task.slice(0, MAX_TASK_CHARACTERS),
    steps: Object.fromEntries(
      steps.map((step, index) => [
        String(index + 1),
        { text: step.slice(0, STEP_CHARACTERS), ...stepFiles(step) },
      ]),
    ),
  };
  return { state, questions };
}

function answered(response: SystemOneResponse, key: string): NoulVerdict | null {
  const answer = response.answers[key];
  return answer?.type === 'noul' ? noulVerdict(answer.noul) : null;
}

export function parseParallelAnswers(count: number, response: SystemOneResponse): ParallelVerdicts {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return {
    independent: indexes.slice(0, -1).map((index) => answered(response, independentKey(index))),
    large: indexes.map((index) => answered(response, largeKey(index))),
  };
}

function runs(linked: readonly boolean[], count: number): number[][] {
  const result: number[][] = [];
  let current: number[] = [0];
  for (let index = 1; index < count; index += 1) {
    if (linked[index - 1]) current.push(index);
    else {
      result.push(current);
      current = [index];
    }
  }
  result.push(current);
  return result.filter((run) => run.length > 1);
}

const inSameGroup = (groups: readonly number[][], a: number, b: number) =>
  groups.some((group) => group.includes(a) && group.includes(b));

function decisions(
  candidates: readonly number[][],
  groups: readonly number[][],
  rulesGroups: readonly number[][],
  pairs: readonly PairDecision[],
  sizes: readonly SizeDecision[],
): GroupDecision[] {
  const seen = new Set<string>();
  return [...groups, ...rulesGroups, ...candidates]
    .filter((group) => {
      const key = group.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((group) => {
      const byJev =
        pairs.some((pair) => group.includes(pair.steps[0]) && pair.source === 'jev') ||
        sizes.some((size) => group.includes(size.step) && size.source === 'jev');
      return {
        steps: [...group],
        parallel: groups.some((chosen) => chosen.join(',') === group.join(',')),
        rules: rulesGroups.some((chosen) => chosen.join(',') === group.join(',')),
        source: byJev ? 'jev' : 'rules',
      };
    });
}

export function chooseGroups(
  steps: readonly string[],
  hinted: readonly number[][],
  large: readonly number[],
  verdicts: ParallelVerdicts | null,
): ParallelChoice {
  const candidates = planGroups(steps, hinted);
  const rulesGroups = worthSplitting(candidates, steps, large);
  if (!verdicts) {
    const decided = decisions(candidates, rulesGroups, rulesGroups, [], []);
    return { groups: rulesGroups, rulesGroups, pairs: [], sizes: [], decided };
  }
  const pairs: PairDecision[] = steps.slice(0, -1).map((_, index) => {
    const rules = inSameGroup(candidates, index, index + 1);
    const jev = verdicts.independent[index] ?? null;
    const value = jev?.value ?? null;
    return {
      steps: [index, index + 1],
      rules,
      jev,
      independent: value ?? rules,
      source: value === null ? 'rules' : 'jev',
    };
  });
  const sizes: SizeDecision[] = steps.map((step, index) => {
    const rules = worthItsOwnBuilder(step, index, large);
    const jev = verdicts.large[index] ?? null;
    const value = isResearchStep(step) ? null : (jev?.value ?? null);
    return {
      step: index,
      rules,
      jev,
      large: value ?? rules,
      source: value === null ? 'rules' : 'jev',
    };
  });
  const linked = runs(
    pairs.map((pair) => pair.independent),
    steps.length,
  );
  const groups = linked.filter((group) => group.every((index) => sizes[index]!.large));
  return {
    groups,
    rulesGroups,
    pairs,
    sizes,
    decided: decisions(linked, groups, rulesGroups, pairs, sizes),
  };
}

export function agreement(choice: ParallelChoice): { asked: number; agreed: number } {
  const confident = [
    ...choice.pairs.map((pair) => ({ jev: pair.jev?.value ?? null, rules: pair.rules })),
    ...choice.sizes.map((size) => ({ jev: size.jev?.value ?? null, rules: size.rules })),
  ].filter((entry) => entry.jev !== null);
  return {
    asked: confident.length,
    agreed: confident.filter((entry) => entry.jev === entry.rules).length,
  };
}
