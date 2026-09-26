export const JEV_STUB_CONFIDENCE = 0.81;
export const CREW_MARKER = '#crew';
export const UNSURE_MARKER = '#unsure';
export const RETRY_MARKER = '#retry';
export const DEBUG_MARKER = '#debug';

interface StubQuestion {
  type: 'choice' | 'score' | 'noul';
  criteria?: Record<string, string> | string[];
}

export interface StubRequest {
  state: Record<string, unknown>;
  questions: Record<string, StubQuestion>;
}

type Answer = Record<string, unknown>;

const RISKS = ['read-only', 'edits', 'multi-file', 'destructive'];
const PREFERRED_MODELS = /^(sonnet|gpt-6-sol)$/;

function choice(value: string, confidence: number): Answer {
  return { type: 'choice', choice: value, probabilities: { [value]: 0.9 }, confidence };
}

function score(value: number, confidence: number): Answer {
  return { type: 'score', score: value, confidence };
}

function options(question: StubQuestion): string[] {
  return Array.isArray(question.criteria)
    ? question.criteria
    : Object.keys(question.criteria ?? {});
}

const UNSURE_NOUL = /^(independent|large)_/;
const ARCHITECT_ROUTE = /_architect_/;
const ARCHITECT_CONFIDENCE = 0.45;

function genericAnswer(key: string, question: StubQuestion, confidence: number): Answer {
  if (question.type === 'noul') return { type: 'noul', noul: UNSURE_NOUL.test(key) ? 0.5 : 0.04 };
  const offered = options(question);
  if (question.type === 'score') return score(Math.min(1, offered.length - 1), confidence);
  if (key === 'build_style') return choice(offered.at(-1)!, confidence);
  const preferred: Record<string, string> = {
    intent: 'bug_fix',
    depth: 'execute',
    scope: 'few_modules',
  };
  const model = key.startsWith('model_') ? offered.find((id) => PREFERRED_MODELS.test(id)) : null;
  return choice(
    model ?? (offered.includes(preferred[key] ?? '') ? preferred[key]! : offered[0]!),
    confidence,
  );
}

function intakeAnswers(request: StubRequest, task: string): Record<string, Answer> {
  const confidence = task.includes(UNSURE_MARKER) ? 0.55 : JEV_STUB_CONFIDENCE;
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [
      key,
      genericAnswer(key, question, confidence),
    ]),
  );
  if (task.includes(DEBUG_MARKER)) answers.intent = choice('debugging', confidence);
  if (!task.includes(CREW_MARKER)) return answers;
  return {
    ...answers,
    depth: choice('plan_execute_review', confidence),
    risk: score(RISKS.indexOf('multi-file'), confidence),
  };
}

function transitionAnswers(request: StubRequest, task: string): Record<string, Answer> {
  const offered = options(request.questions.next ?? { type: 'choice' });
  const retrying = task.includes(RETRY_MARKER) && request.state.retriesLeft === 2;
  if (retrying && offered.includes('retry_up')) {
    return {
      status: choice('needs_more_work', JEV_STUB_CONFIDENCE),
      quality: score(1, JEV_STUB_CONFIDENCE),
      next: choice('retry_up', JEV_STUB_CONFIDENCE),
    };
  }
  return {
    status: choice('done', 0.95),
    quality: score(3, 0.95),
    next: choice(offered.includes('next_step') ? 'next_step' : 'finish', 0.95),
  };
}

export function jevAnswers(request: StubRequest): Record<string, Answer> {
  const task = String(request.state.task ?? '');
  if (request.questions.intent) return intakeAnswers(request, task);
  if (request.questions.status) return transitionAnswers(request, task);
  return Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [
      key,
      genericAnswer(key, question, ARCHITECT_ROUTE.test(key) ? ARCHITECT_CONFIDENCE : 0.9),
    ]),
  );
}
