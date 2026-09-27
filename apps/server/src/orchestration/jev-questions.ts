import {
  agentRoleLabel,
  type CardCategory,
  transitionNextSchema,
  transitionStatusSchema,
  type AgentRole,
  type ReviewVerdict,
  type TransitionNext,
  type TransitionStatus,
} from '@spark-outpost/contracts';
import { AdvisorError, type AdvisorCandidate, type AdvisorOption } from '../advisor/advice.ts';
import {
  effortInstructions,
  MAX_TASK_CHARACTERS,
  modelOptionText,
  selectableModels,
  type IntakeQuestions,
  type SystemOneResponse,
} from '../advisor/intake-questions.ts';
import { effortLevels } from '../advisor/questions.ts';
import { redactText } from '../audit/redact.ts';

export const STEP_CHARACTERS = 300;
export const REPLY_CHARACTERS = 1_000;

export function forJev(text: string): string {
  return redactText(text);
}

export interface RouteSlot {
  key: string;
  role: AgentRole;
  step: string | null;
  candidate: AdvisorCandidate;
  category?: CardCategory | null;
}

export interface RoutePick {
  model: AdvisorOption | null;
  effort: string | null;
  confidence: number | null;
}

export function buildRouteQuestions(task: string, slots: readonly RouteSlot[]): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  const work: Record<string, string> = {};
  for (const slot of slots) {
    const role = agentRoleLabel(slot.role);
    work[slot.key] = slot.step ? `${role}: ${forJev(slot.step).slice(0, STEP_CHARACTERS)}` : role;
    const models = selectableModels(slot.candidate);
    if (models.length > 1) {
      questions[`model_${slot.key}`] = {
        type: 'choice',
        instructions: `Which ${slot.candidate.name} model should do \`work.${slot.key}\`, one part of \`task\`? Prefer faster, cheaper models for simple parts and stronger models for complex or risky parts.`,
        criteria: Object.fromEntries(
          models.map((model) => [
            model.id,
            modelOptionText(slot.candidate, model, slot.category ?? null),
          ]),
        ),
      };
    }
    if (slot.candidate.efforts.length > 1) {
      questions[`effort_${slot.key}`] = {
        type: 'score',
        instructions: effortInstructions(
          slot.candidate,
          `How much reasoning effort does \`work.${slot.key}\` need?`,
        ),
        criteria: effortLevels(slot.candidate.efforts),
      };
    }
  }
  return { state: { task: task.slice(0, MAX_TASK_CHARACTERS), work }, questions };
}

export function parseRouteAnswers(
  slots: readonly RouteSlot[],
  response: SystemOneResponse,
): Map<string, RoutePick> {
  const picks = new Map<string, RoutePick>();
  for (const slot of slots) {
    const models = selectableModels(slot.candidate);
    const modelAnswer = response.answers[`model_${slot.key}`];
    const effortAnswer = response.answers[`effort_${slot.key}`];
    let model: AdvisorOption | null = models.length === 1 ? models[0]! : null;
    let confidence: number | null = null;
    if (models.length > 1) {
      if (modelAnswer?.type !== 'choice')
        throw new AdvisorError(`Jev did not answer model_${slot.key}.`);
      model = models.find((option) => option.id === modelAnswer.choice) ?? null;
      if (!model) throw new AdvisorError(`Jev chose a model that was not offered for ${slot.key}.`);
      confidence = modelAnswer.confidence;
    }
    let effort = slot.candidate.efforts[0]?.id ?? null;
    if (slot.candidate.efforts.length > 1) {
      if (effortAnswer?.type !== 'score')
        throw new AdvisorError(`Jev did not answer effort_${slot.key}.`);
      const index = Math.round(effortAnswer.score);
      if (index < 0 || index >= slot.candidate.efforts.length) {
        throw new AdvisorError(`Jev scored effort_${slot.key} outside the offered levels.`);
      }
      effort = slot.candidate.efforts[index]!.id;
    }
    picks.set(slot.key, { model, effort, confidence });
  }
  return picks;
}

export interface TransitionFacts {
  task: string;
  role: AgentRole;
  step: string | null;
  outcome: 'succeeded' | 'failed';
  reply: string;
  stepsLeft: number;
  retriesLeft: number;
  reviewed: boolean;
  verdict: ReviewVerdict | null;
  findings: number;
  filesChanged: number;
  toolCalls: number;
}

const STATUS_CRITERIA: Record<TransitionStatus, string> = {
  done: 'The work for this part is done well enough to move on',
  needs_more_work: 'The work is incomplete or wrong and another attempt could fix it',
  blocked: 'The agent could not proceed because something outside its control stopped it',
  needs_you: 'Only the user can decide how to continue',
};

const NEXT_CRITERIA: Record<TransitionNext, string> = {
  next_step: 'Move on to the next planned step',
  retry_up: 'Try this part again with a stronger model',
  review: 'Have an independent reviewer check the change',
  finish: 'Stop here; the request is handled',
};

export const QUALITY_CRITERIA = [
  {
    what: 'The work was not done: the agent failed, changed nothing useful, or changed the wrong thing',
    examples: [
      'the reply reports an error it could not get past',
      'the verdict rejects the change',
    ],
  },
  {
    what: 'Only part of it was done: pieces the step asked for are missing or broken',
    examples: ['a function added but never called', 'the reply lists work it did not get to'],
  },
  {
    what: 'It was done and works, but the reply or the review names problems that still need fixing',
    examples: ['a failing edge case is mentioned', 'the verdict asks for changes'],
  },
  {
    what: 'It was done and works; only small follow-ups remain, such as naming or one more test',
    examples: ['the review has minor comments only'],
  },
  {
    what: 'It was done completely and checked, and nothing is left to fix',
    examples: ['the reply says checks pass and the review found nothing'],
  },
];

export function stepsLeftBucket(count: number): string {
  if (count === 0) return 'this was the last step';
  return count === 1 ? 'one more step' : 'several more steps';
}

export function retriesLeftBucket(count: number): string {
  if (count === 0) return 'none left';
  return count === 1 ? 'one left' : 'several left';
}

export function findingsBucket(count: number): string {
  if (count === 0) return 'none';
  return count <= 2 ? 'a few' : 'many';
}

export function filesChangedBucket(count: number): string {
  if (count === 0) return 'none';
  if (count === 1) return 'one file';
  return count <= 5 ? 'a few files' : 'many files';
}

export function toolCallsBucket(count: number): string {
  if (count === 0) return 'none';
  if (count <= 10) return 'a few';
  return count <= 40 ? 'many' : 'a great many';
}

export function offeredNext(facts: TransitionFacts): TransitionNext[] {
  return transitionNextSchema.options.filter((next) => {
    if (next === 'next_step') return facts.stepsLeft > 0;
    if (next === 'retry_up') return facts.retriesLeft > 0;
    if (next === 'review') return !facts.reviewed;
    return true;
  });
}

export function buildTransitionQuestions(facts: TransitionFacts): IntakeQuestions {
  const next = offeredNext(facts);
  return {
    state: {
      task: facts.task.slice(0, MAX_TASK_CHARACTERS),
      role: facts.role,
      step: facts.step ? forJev(facts.step).slice(0, STEP_CHARACTERS) : null,
      outcome: facts.outcome,
      reply: forJev(facts.reply).slice(-REPLY_CHARACTERS),
      stepsLeft: stepsLeftBucket(facts.stepsLeft),
      retriesLeft: retriesLeftBucket(facts.retriesLeft),
      verdict: facts.verdict,
      findings: findingsBucket(facts.findings),
      filesChanged: filesChangedBucket(facts.filesChanged),
      toolCalls: toolCallsBucket(facts.toolCalls),
    },
    questions: {
      status: {
        type: 'choice',
        instructions: `The ${agentRoleLabel(facts.role)} just finished its part of \`task\` with \`outcome\`; \`reply\` is the end of what it said. Where does the work stand?`,
        criteria: STATUS_CRITERIA,
      },
      quality: {
        type: 'score',
        instructions:
          'Which situation fits the work, judged from `reply`, `verdict`, `findings` and `filesChanged`?',
        criteria: QUALITY_CRITERIA,
      },
      next: {
        type: 'choice',
        instructions: 'What should happen next?',
        criteria: Object.fromEntries(next.map((option) => [option, NEXT_CRITERIA[option]])),
      },
    },
  };
}

export interface TransitionPick {
  status: TransitionStatus;
  next: TransitionNext;
  quality: number | null;
  confidence: number;
}

export function parseTransitionAnswers(
  facts: TransitionFacts,
  response: SystemOneResponse,
): TransitionPick {
  const status = response.answers.status;
  const next = response.answers.next;
  const quality = response.answers.quality;
  if (status?.type !== 'choice' || next?.type !== 'choice') {
    throw new AdvisorError('Jev did not answer the transition questions.');
  }
  const parsedStatus = transitionStatusSchema.safeParse(status.choice);
  const offered = offeredNext(facts);
  const parsedNext = offered.find((option) => option === next.choice);
  if (!parsedStatus.success || !parsedNext) {
    throw new AdvisorError('Jev chose a transition that was not offered.');
  }
  return {
    status: parsedStatus.data,
    next: parsedNext,
    quality: quality?.type === 'score' ? Math.max(0, Math.min(4, quality.score)) : null,
    confidence: Math.min(status.confidence, next.confidence),
  };
}
