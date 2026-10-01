export const JEV_STUB_CONFIDENCE = 0.81;
export const CREW_MARKER = '#crew';
export const UNSURE_MARKER = '#unsure';
export const DEBUG_MARKER = '#debug';
export const VAGUE_MARKER = '#vague';
export const UNSUPPORTED_MARKER = '#unsupported';
export const DECLINED_MARKER = '#declined';
export const MAYBE_AGREED_MARKER = '#maybe';

interface StubQuestion {
  type: 'choice' | 'score' | 'noul';
  criteria?: Record<string, unknown> | unknown[];
}

export interface StubRequest {
  state: Record<string, unknown>;
  questions: Record<string, StubQuestion>;
}

type Answer = Record<string, unknown>;

function choice(value: string, confidence: number): Answer {
  return { type: 'choice', choice: value, probabilities: { [value]: 0.9 }, confidence };
}

const noul = (value: number): Answer => ({ type: 'noul', noul: value });

function options(question: StubQuestion): string[] {
  return Array.isArray(question.criteria)
    ? question.criteria.map(String)
    : Object.keys(question.criteria ?? {});
}

function nouls(task: string): Record<string, number> {
  return {
    question: task.includes(UNSURE_MARKER) ? 0.6 : 0.03,
    review: task.includes(CREW_MARKER) ? 0.95 : 0.02,
    destructive: 0.03,
    vague: task.includes(VAGUE_MARKER) ? 0.96 : 0.04,
    continues_task: 0.9,
    plan_agreed: task.includes(MAYBE_AGREED_MARKER) ? 0.7 : 0.05,
    injection: 0.02,
  };
}

function intakeAnswers(request: StubRequest, task: string): Record<string, Answer> {
  const values = nouls(task);
  const answers: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') answers[key] = noul(values[key] ?? 0.05);
    else if (key === 'tier')
      answers[key] = choice(options(question).includes('mid') ? 'mid' : options(question)[0]!, 0.9);
    else answers[key] = choice('bug_fix', JEV_STUB_CONFIDENCE);
  }
  if (task.includes(DEBUG_MARKER)) answers.intent = choice('debugging', JEV_STUB_CONFIDENCE);
  if (task.includes(VAGUE_MARKER)) {
    answers.intent = {
      type: 'choice',
      choice: 'docs',
      probabilities: { docs: 0.6, feature: 0.3, refactor: 0.1 },
      confidence: JEV_STUB_CONFIDENCE,
    };
  }
  return answers;
}

function verdictFor(task: string): string {
  if (task.includes(UNSUPPORTED_MARKER)) return 'unsupported';
  if (task.includes(DECLINED_MARKER)) return 'declined';
  return 'supported';
}

function spread(offered: readonly string[], value: string, confidence: number): Answer {
  const rest = offered.filter((option) => option !== value);
  const probabilities = Object.fromEntries([
    [value, 0.9],
    ...rest.map((option) => [option, 0.1 / rest.length]),
  ]);
  return { type: 'choice', choice: value, probabilities, confidence };
}

function pieceAnswer(key: string, question: StubQuestion): Answer | null {
  if (question.type === 'score') return { type: 'score', score: 1, confidence: 0.9 };
  const offered = options(question);
  if (key.endsWith('_builder')) {
    const route = offered.find((option) => option !== 'uncertain')!;
    return spread(offered, route, JEV_STUB_CONFIDENCE);
  }
  if (key.endsWith('_placement')) return spread(offered, offered[0]!, 0.6);
  return null;
}

export function jevAnswers(request: StubRequest): Record<string, Answer> {
  const task = String(request.state.task ?? '');
  if (request.questions.intent) return intakeAnswers(request, task);
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [
      key,
      pieceAnswer(key, question) ?? noul(key.startsWith('finding_') ? 0.5 : 0.05),
    ]),
  );
  if (request.questions.verdict) answers.verdict = choice(verdictFor(task), 0.95);
  return answers;
}
