interface StubQuestion {
  type: 'choice' | 'score' | 'noul';
  criteria?: Record<string, unknown> | unknown[];
}

export interface StubRequest {
  state: Record<string, unknown>;
  questions: Record<string, StubQuestion>;
}

type Answer = Record<string, unknown>;

const UNSURE = 0.05;

export function jevAnswers(request: StubRequest): Record<string, Answer> {
  return Object.fromEntries(
    Object.keys(request.questions).map((key) => [key, { type: 'noul', noul: UNSURE }]),
  );
}
