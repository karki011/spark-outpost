import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type Approval,
  type ApprovalOption,
  type QuestionAnswerInput,
} from '@spark-outpost/contracts';
import { clarifyAnswer } from '../chat/checkpoints/checkpoint-model.ts';

export interface QuestionPick {
  label: string;
  optionId: string;
  note?: string;
  answers?: QuestionAnswerInput[];
}

export function askedChoices(approval: Approval | null): string[] | null {
  const checkpoint = approval?.payload.checkpoint;
  if (checkpoint?.kind !== 'clarify' || checkpoint.questions.length !== 1) return null;
  const question = checkpoint.questions[0]!;
  if (question.pick === 'many' || question.options.length === 0) return null;
  return [...question.options];
}

function askedPick(approval: Approval, label: string): QuestionPick {
  const questions = approval.payload.checkpoint?.questions ?? [];
  const given = [{ picks: [label], text: '' }];
  const note = clarifyAnswer(questions, given, '');
  const pick = { label, optionId: CHECKPOINT_OPTION.answer, note };
  return approval.payload.form === undefined ? pick : { ...pick, answers: given };
}

export function questionPicks(approval: Approval): QuestionPick[] {
  const choices = approval.payload.checkpoint?.choices ?? [];
  if (choices.length > 0) {
    return choices.map((label, index) => ({ label, optionId: clarifyOptionId(index) }));
  }
  return (askedChoices(approval) ?? []).map((label) => askedPick(approval, label));
}

export function pickDecision(pick: QuestionPick, who: string) {
  const option: ApprovalOption = { optionId: pick.optionId, name: pick.label, kind: 'allow_once' };
  return {
    option,
    scope: 'once' as const,
    said: { title: `Got it, using ${pick.label}`, sub: `${who} carries on.` },
    ...(pick.note === undefined ? {} : { note: pick.note }),
    ...(pick.answers === undefined ? {} : { answers: pick.answers }),
  };
}
