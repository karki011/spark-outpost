import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  formQuestions,
  type ApprovalOption,
} from '@spark-outpost/contracts';
import { approvalAnswerContent, getApproval, type NewApproval } from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import type {
  AgentQuestion,
  GateAnswer,
  QuestionGate,
  QuestionReply,
} from '../providers/provider.ts';
import type { RunObservations } from '../observations/run-observations.ts';
import { addressOpener } from './address-card.ts';
import { raiseWithdrawable } from './withdrawable-card.ts';
import type { ApprovalGate } from './approval-gate.ts';

export const QUESTION_OPTIONS: ApprovalOption[] = [
  { optionId: CHECKPOINT_OPTION.answer, name: 'Send', kind: 'allow_once' },
  { optionId: CHECKPOINT_OPTION.finish, name: 'Skip', kind: 'reject_once' },
];

const CANCEL: QuestionReply = { action: 'cancel' };

export function questionCard(runId: string, question: AgentQuestion): NewApproval {
  const { form } = question;
  const questions = formQuestions(form);
  return {
    runId,
    toolCallId: question.toolCallId,
    rpcId: question.rpcId,
    kind: 'clarify',
    title: questions.length === 1 ? questions[0]!.question : form.message || 'Questions',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      checkpoint: checkpointPayloadSchema.parse({
        kind: 'clarify',
        question: form.message,
        reason: '',
        questions,
        agent: question.agent,
      }),
      form,
    },
    options: QUESTION_OPTIONS,
    reason: null,
  };
}

async function reply(db: Db, answer: GateAnswer): Promise<QuestionReply> {
  if (answer.outcome !== 'selected' || !answer.approvalId) return CANCEL;
  const approval = await getApproval(db, answer.approvalId);
  if (approval?.status === 'denied') return { action: 'decline' };
  const answered =
    approval?.status === 'allowed' && approval.decisionOptionId === CHECKPOINT_OPTION.answer;
  if (!answered) return CANCEL;
  const content = await approvalAnswerContent(db, approval.id);
  return content ? { action: 'accept', content } : CANCEL;
}

export function createQuestionGate(
  db: Db,
  runId: string,
  gate: ApprovalGate,
  observations?: RunObservations,
): QuestionGate {
  return {
    async ask(question, signal, agentCancel) {
      if (signal.aborted || agentCancel.aborted) return CANCEL;
      const card = questionCard(runId, question);
      return reply(db, await raiseWithdrawable(db, gate, card, signal, agentCancel));
    },
    open: addressOpener({ db, runId, gate, observations }),
  };
}
