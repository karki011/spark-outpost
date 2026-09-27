import type { IntakeQuestions, SystemOneResponse } from '../advisor/intake-questions.ts';
import { noulQuestion } from '../advisor/questions.ts';
import { forJev, STEP_CHARACTERS } from './jev-questions.ts';

export const STEP_OPEN_AT = 0.8;
export const STEP_DONE_AT_MOST = 0.2;
export const CRITERIA_PER_STEP = 3;
export const CRITERION_CHARACTERS = 200;

export interface StepCheck {
  stepIndex: number;
  text: string;
  criteria: string[];
}

export type StepVerdict = 'open' | 'done' | 'unsure';

export interface StepCheckAnswer {
  stepIndex: number;
  worst: number;
  worstKey: string;
  verdict: StepVerdict;
}

const notDoneKey = (step: number) => `step_not_done_${step + 1}`;
const leftKey = (step: number) => `step_left_${step + 1}`;
const criterionKey = (step: number, item: number) => `criterion_unmet_${step + 1}_${item + 1}`;

export function stepChecksFor(
  steps: readonly string[],
  indexes: readonly number[],
  criteriaFor: (stepIndex: number) => readonly string[],
): StepCheck[] {
  const seen = new Set<string>();
  return indexes.flatMap((stepIndex) => {
    const text = steps[stepIndex]?.trim();
    if (!text) return [];
    const criteria = criteriaFor(stepIndex)
      .map((item) => item.trim())
      .filter((item) => item && !seen.has(item))
      .slice(0, CRITERIA_PER_STEP);
    for (const item of criteria) seen.add(item);
    return [{ stepIndex, text, criteria }];
  });
}

export function buildStepCheckQuestions(
  checks: readonly StepCheck[],
): IntakeQuestions['questions'] {
  const questions: IntakeQuestions['questions'] = {};
  for (const check of checks) {
    const planStep = forJev(check.text).slice(0, STEP_CHARACTERS);
    questions[notDoneKey(check.stepIndex)] = noulQuestion(
      { plan_step: planStep, question: 'Is there no sign in `reply` that `plan_step` was done?' },
      {
        true: 'The reply does not mention doing this step, or only says it was planned or started',
        false: 'The reply says this step was done, or describes doing it',
      },
    );
    questions[leftKey(check.stepIndex)] = noulQuestion(
      {
        plan_step: planStep,
        question:
          'Does `reply` say that `plan_step` was not finished, was skipped, failed, or is left for later?',
      },
      {
        true: 'The reply says this step is unfinished, skipped, failed or left for later',
        false: 'The reply says nothing of the kind about this step',
      },
    );
    check.criteria.forEach((criterion, item) => {
      questions[criterionKey(check.stepIndex, item)] = noulQuestion(
        {
          plan_step: planStep,
          criterion: forJev(criterion).slice(0, CRITERION_CHARACTERS),
          question: 'Does `reply` show that `criterion`, promised for `plan_step`, is not met?',
        },
        {
          true: 'The reply says or shows it is missing, broken, failing or only partly done',
          false: 'The reply is consistent with it being met, or does not speak to it',
        },
      );
    });
  }
  return questions;
}

export function withStepChecks(asked: IntakeQuestions, checks: readonly StepCheck[]) {
  return { ...asked, questions: { ...asked.questions, ...buildStepCheckQuestions(checks) } };
}

function verdictOf(worst: number): StepVerdict {
  if (worst >= STEP_OPEN_AT) return 'open';
  return worst <= STEP_DONE_AT_MOST ? 'done' : 'unsure';
}

export function parseStepChecks(
  checks: readonly StepCheck[],
  response: SystemOneResponse,
): StepCheckAnswer[] {
  return checks.flatMap((check) => {
    const keys = [
      notDoneKey(check.stepIndex),
      leftKey(check.stepIndex),
      ...check.criteria.map((_, item) => criterionKey(check.stepIndex, item)),
    ];
    const answered = keys.flatMap((key) => {
      const answer = response.answers[key];
      return answer?.type === 'noul' ? [{ key, noul: answer.noul }] : [];
    });
    if (answered.length === 0) return [];
    const worst = answered.reduce((a, b) => (b.noul > a.noul ? b : a));
    return [
      {
        stepIndex: check.stepIndex,
        worst: worst.noul,
        worstKey: worst.key,
        verdict: verdictOf(worst.noul),
      },
    ];
  });
}

export function openSteps(answers: readonly StepCheckAnswer[]): number[] {
  return answers.filter((answer) => answer.verdict === 'open').map((answer) => answer.stepIndex);
}

export function stepCheckSummary(answers: readonly StepCheckAnswer[]): string | null {
  const open = answers.filter((answer) => answer.verdict === 'open');
  if (open.length === 0) return null;
  const list = open.map((answer) => `${answer.stepIndex + 1} (${answer.worst.toFixed(2)})`);
  return `Jev: step ${list.join(', ')} not done`;
}
