import { SPEED_KEY } from '../orchestration/clarify.ts';
import type { IntakeRequest } from './advice.ts';
import type { IntakeQuestions } from './intake-questions.ts';

const DO_QUESTIONS = ['plan_only', 'review', 'destructive', 'vague'] as const;
const REPLY_QUESTIONS: readonly string[] = ['plan_agreed', 'previous_is_plan'];

function reasonFor(key: string, request: IntakeRequest): string {
  if (
    request.mode !== 'do' &&
    !REPLY_QUESTIONS.includes(key) &&
    key !== 'injection' &&
    key !== 'tier'
  ) {
    return 'not a Do turn';
  }
  if (key === 'continues_task') return 'no current task';
  if (REPLY_QUESTIONS.includes(key)) return 'no previous reply';
  if (key === 'injection') return 'no attached text';
  if (key === SPEED_KEY) return 'not a first request to make something faster';
  if (key === 'tier') return request.mode === 'chat' ? 'chat turn' : 'fewer than two model tiers';
  return 'not applicable';
}

export function notAskedReasons(
  request: IntakeRequest,
  asked: IntakeQuestions,
): Record<string, string> {
  const keys = [
    ...DO_QUESTIONS,
    'continues_task',
    SPEED_KEY,
    ...REPLY_QUESTIONS,
    'injection',
    'tier',
  ];
  return Object.fromEntries(
    keys.filter((key) => !asked.questions[key]).map((key) => [key, reasonFor(key, request)]),
  );
}
