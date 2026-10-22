import {
  CHECKPOINT_OPTION,
  isCheckpointKind,
  type AgentPick,
  type Approval,
  type CheckpointPayload,
  type CheckpointQuestion,
} from '@spark-outpost/contracts';
import { filesLabel } from '../changes/change-rules.ts';
import { shortLabel } from '../composer/model-options.ts';

export interface CheckpointApproval extends Approval {
  payload: Approval['payload'] & { checkpoint: CheckpointPayload };
}

export function isCheckpoint(approval: Approval): approval is CheckpointApproval {
  return isCheckpointKind(approval.kind) && approval.payload.checkpoint !== undefined;
}

export function offers(approval: Approval, optionId: string): boolean {
  return approval.options.some((option) => option.optionId === optionId);
}

export function optionName(approval: Approval, optionId: string): string | null {
  return approval.options.find((option) => option.optionId === optionId)?.name ?? null;
}

const TITLES: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Jev has a question',
  plan: 'Approve the plan?',
  retry: 'A step needs another try',
  accept: 'Keep these changes?',
  budget: 'Paused at a budget',
  merge_conflict: 'The Builder’s copy and your files collided',
  stuck: 'The Builder was repeating itself',
  verify: 'Jev could not verify the change',
  ownership: 'A Builder changed a file outside its piece',
  pieces: 'Build in pieces?',
  pr_split: 'One PR or separate PRs?',
  compact: 'This chat is almost full',
};

export const SPARK_QUESTIONS_TITLE = 'Spark has a few questions';
const SPARK_QUESTION_TITLE = 'Spark has a question';

export function asksQuestions(payload: CheckpointPayload): boolean {
  return payload.kind === 'clarify' && payload.questions.length > 0;
}

function questionsTitle(payload: CheckpointPayload): string {
  const one = payload.questions.length === 1;
  if (payload.agent)
    return one ? `${payload.agent} has a question` : `${payload.agent} has questions`;
  return one ? SPARK_QUESTION_TITLE : SPARK_QUESTIONS_TITLE;
}

export function checkpointTitle(payload: CheckpointPayload): string {
  if (asksQuestions(payload)) return questionsTitle(payload);
  if (payload.kind === 'stuck')
    return payload.agent ? `${payload.agent} was repeating itself` : TITLES.stuck;
  if (payload.kind === 'ownership') {
    return payload.agent ? `${payload.agent} changed a file outside its piece` : TITLES.ownership;
  }
  if (payload.agent) return `${payload.agent} needs your input`;
  if ((payload.kind === 'plan' || payload.kind === 'pieces') && payload.question) {
    return payload.question;
  }
  return TITLES[payload.kind];
}

export function quickPicks(question: CheckpointQuestion): string[] {
  return [...new Set([question.default, ...question.options])].filter(Boolean);
}

export function takesText(question: CheckpointQuestion): boolean {
  return question.freeText !== false;
}

export interface QuestionAnswer {
  picks: readonly string[];
  text: string;
}

export const NO_ANSWER: QuestionAnswer = { picks: [], text: '' };

export function togglePick(
  answer: QuestionAnswer,
  pick: string,
  question?: CheckpointQuestion,
): QuestionAnswer {
  if (answer.picks.includes(pick)) {
    return { ...answer, picks: answer.picks.filter((picked) => picked !== pick) };
  }
  const picks = question?.pick === 'one' ? [pick] : [...answer.picks, pick];
  return { ...answer, picks };
}

export function answerText(question: CheckpointQuestion, answer: QuestionAnswer): string {
  const picked = quickPicks(question)
    .filter((pick) => answer.picks.includes(pick))
    .join(', ');
  const typed = answer.text.trim().replace(/\s*\n\s*/g, ' ');
  if (picked && typed) return `${picked} — plus: ${typed}`;
  return picked || typed;
}

const ANSWERS = ' → ';

export function clarifyAnswer(
  questions: readonly CheckpointQuestion[],
  answers: readonly QuestionAnswer[],
  ownWords: string,
): string {
  const answered = questions.flatMap((question, index) => {
    const answer = answerText(question, answers[index] ?? NO_ANSWER);
    return answer ? [`${question.question}${ANSWERS}${answer}`] : [];
  });
  const own = ownWords.trim();
  return [...answered, ...(own ? [own] : [])].join('\n');
}

interface SentAnswers {
  answers: (string | null)[];
  ownWords: string;
}

export function sentAnswers(
  questions: readonly CheckpointQuestion[],
  note: string | null,
): SentAnswers {
  const answers: (string | null)[] = questions.map(() => null);
  const own: string[] = [];
  for (const line of (note ?? '').split('\n')) {
    const index = questions.findIndex(
      (question, at) => answers[at] === null && line.startsWith(`${question.question}${ANSWERS}`),
    );
    if (index < 0) {
      own.push(line);
      continue;
    }
    answers[index] = line.slice(questions[index]!.question.length + ANSWERS.length);
  }
  return { answers, ownWords: own.join('\n').trim() };
}

export function answeredNote(approval: Approval): string | null {
  return approval.decisionOptionId === CHECKPOINT_OPTION.answer ? (approval.note ?? null) : null;
}

export function saidNote(approval: Approval): string | null {
  const checkpoint = approval.payload.checkpoint;
  if (!checkpoint || !asksQuestions(checkpoint) || answeredNote(approval) === null) {
    return approval.note ?? null;
  }
  return sentAnswers(checkpoint.questions, approval.note ?? null).ownWords || null;
}

export function checkpointQuestion(payload: CheckpointPayload): string | null {
  if (asksQuestions(payload)) return null;
  return payload.question === checkpointTitle(payload) ? null : payload.question;
}

const WAITING_LABELS: Record<CheckpointPayload['kind'], string> = {
  clarify: 'Answer Jev’s question',
  plan: 'Approve the plan',
  retry: 'Retry, or stop and report',
  accept: 'Keep, fix, or revert the changes',
  budget: 'Continue, or stop',
  merge_conflict: 'Choose which version to keep',
  stuck: 'Continue, or stop and report',
  verify: 'Finish, retry one tier up, or stop',
  ownership: 'Keep the file in the piece, revert it, or stop',
  pieces: 'Build it, build in order, revise, or stop',
  pr_split: 'Choose one PR or separate PRs',
  compact: 'Compact, start fresh, or keep going',
};

export function waitingLabel(payload: CheckpointPayload): string {
  if (asksQuestions(payload)) return `Answer ${payload.agent ?? 'Spark'}’s questions`;
  if (payload.kind === 'stuck') {
    return payload.agent ? `Continue ${payload.agent}, or stop` : WAITING_LABELS.stuck;
  }
  if (payload.agent) return `Answer ${payload.agent}`;
  if (payload.kind === 'plan' && payload.question && payload.question !== TITLES.plan) {
    return 'Build it, or stop';
  }
  return WAITING_LABELS[payload.kind];
}

export function pickLabel(pick: AgentPick | null): string | null {
  if (!pick) return null;
  const model = pick.modelLabel ? shortLabel(pick.modelLabel) : pick.model;
  return [model, pick.effort].filter(Boolean).join(' · ') || null;
}

function escalatedPick(payload: CheckpointPayload): string | null {
  const to = pickLabel(payload.to);
  return to && to !== pickLabel(payload.from) ? to : null;
}

export function retryLine(payload: CheckpointPayload): string {
  const to = escalatedPick(payload);
  return to ? `Retry with ${to}?` : 'Retry the step once more?';
}

export function escalateLabel(payload: CheckpointPayload): string {
  const to = escalatedPick(payload);
  return to ? `Retry with ${to}` : 'Retry one tier up';
}

const RESULTS: Record<string, string> = {
  [CHECKPOINT_OPTION.stop]: 'Stopped.',
  [CHECKPOINT_OPTION.clarifyRules]: 'Left it to the fixed rules.',
  [CHECKPOINT_OPTION.approvePlan]: 'Plan approved.',
  [CHECKPOINT_OPTION.editPlan]: 'Sent your changes to the plan.',
  [CHECKPOINT_OPTION.retry]: 'Retrying.',
  [CHECKPOINT_OPTION.finish]: 'Skipped.',
  [CHECKPOINT_OPTION.keep]: 'Kept the changes.',
  [CHECKPOINT_OPTION.fix]: 'Asked for a fix.',
  [CHECKPOINT_OPTION.fixFindings]: 'Sent the review findings back to the Builder.',
  [CHECKPOINT_OPTION.revert]: 'Reverted the changes.',
  [CHECKPOINT_OPTION.answer]: 'Answered.',
  [CHECKPOINT_OPTION.reconcile]: 'Asked a Builder to reconcile.',
  [CHECKPOINT_OPTION.letContinue]: 'Let it continue.',
  [CHECKPOINT_OPTION.continueStuck]: 'Continued with a note to try another way.',
  [CHECKPOINT_OPTION.stopReport]: 'Stopped and reported.',
  [CHECKPOINT_OPTION.justAnswer]: 'Answered without changes.',
  [CHECKPOINT_OPTION.makeChange]: 'Making the change.',
  [CHECKPOINT_OPTION.finishUnverified]: 'Finished without verification.',
  [CHECKPOINT_OPTION.useDefaults]: 'Went with the best guesses.',
  [CHECKPOINT_OPTION.compactNow]: 'Compacted the chat.',
  [CHECKPOINT_OPTION.freshChat]: 'Started a fresh chat with a summary.',
  [CHECKPOINT_OPTION.keepGoing]: 'Kept going.',
};

const AUTO_LABELS: Record<string, string> = {
  [CHECKPOINT_OPTION.finish]: 'Skip',
  [CHECKPOINT_OPTION.clarifyRules]: 'Continue',
  [CHECKPOINT_OPTION.letContinue]: 'Let it continue',
  [CHECKPOINT_OPTION.stopReport]: 'Stop and report',
  [CHECKPOINT_OPTION.finishUnverified]: 'Finish',
  [CHECKPOINT_OPTION.onePr]: 'One PR',
  [CHECKPOINT_OPTION.keepGoing]: 'Keep going',
};

const COUNTDOWNS: Record<string, string> = {
  [CHECKPOINT_OPTION.useDefaults]: 'Going with my best guesses in',
};

export function autoLabel(optionId: string, seconds: number): string {
  const countdown = COUNTDOWNS[optionId];
  if (countdown) return `${countdown} ${seconds}s`;
  return `${AUTO_LABELS[optionId] ?? 'Continue'} (${seconds}s)`;
}

export function secondsLeft(autoContinueAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(autoContinueAt) - now) / 1000));
}

export function autoDelaySeconds(approval: Approval): number | null {
  if (!approval.autoContinueAt) return null;
  return Math.round((Date.parse(approval.autoContinueAt) - Date.parse(approval.createdAt)) / 1000);
}

export function changesSummary(payload: Pick<CheckpointPayload, 'files' | 'lines'>): string {
  const files = filesLabel(payload.files.length);
  return payload.lines ? `${files} · +${payload.lines.added} −${payload.lines.removed}` : files;
}

export function checkpointResult(approval: Approval): string {
  if (approval.status === 'expired') return 'Expired before you answered.';
  if (approval.decidedBy === 'auto') {
    const delay = autoDelaySeconds(approval);
    const done =
      approval.decisionOptionId === CHECKPOINT_OPTION.useDefaults
        ? 'Went with the best guesses'
        : 'Continued automatically';
    return delay === null ? `${done}.` : `${done} after ${delay}s.`;
  }
  if (approval.decidedBy === 'level' && approval.decisionOptionId === CHECKPOINT_OPTION.keep) {
    const keptBy = approval.payload.checkpoint?.keptBy;
    return keptBy === 'hands-off' ? 'Kept automatically.' : 'Kept by Full auto → PR.';
  }
  if (approval.status === 'cancelled' && approval.decidedBy === 'policy') {
    return 'It moved on before you answered.';
  }
  if (approval.status === 'cancelled') return 'The run stopped before you answered.';
  const id = approval.decisionOptionId;
  if (!id) return approval.status === 'denied' ? 'Stopped.' : 'Answered.';
  const conflict = approval.payload.checkpoint?.conflict;
  if (conflict && id === CHECKPOINT_OPTION.keepFirst) {
    return conflict.first === 'your version'
      ? 'Kept your version.'
      : `Kept ${conflict.first}’s change.`;
  }
  if (conflict && id === CHECKPOINT_OPTION.keepSecond) return `Kept ${conflict.second}’s change.`;
  const askAgainAt = approval.payload.checkpoint?.askAgainAt;
  if (id === CHECKPOINT_OPTION.keepGoing && askAgainAt) {
    return `Kept going; Spark asks again at ${askAgainAt}%.`;
  }
  const choices = approval.payload.checkpoint?.choices ?? [];
  const index = id.startsWith('option:') ? Number(id.slice('option:'.length)) : -1;
  if (index >= 0 && choices[index]) return `You chose: ${choices[index]}`;
  return RESULTS[id] ?? 'Answered.';
}
