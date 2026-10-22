import { homedir } from 'node:os';
import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  formQuestions,
  type ApprovalOption,
} from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import {
  approvalAnswerContent,
  getApproval,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import type {
  AgentQuestion,
  GateAnswer,
  QuestionGate,
  QuestionReply,
} from '../providers/provider.ts';
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

function questionRequest(card: NewApproval): ApprovalRequest {
  return {
    toolCallId: card.toolCallId,
    rpcId: card.rpcId,
    kind: card.kind,
    toolKind: null,
    title: card.title,
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    options: card.options,
    roots: [],
    home: homedir(),
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

export function createQuestionGate(db: Db, runId: string, gate: ApprovalGate): QuestionGate {
  return {
    async ask(question, signal, agentCancel) {
      if (signal.aborted || agentCancel.aborted) return CANCEL;
      const card = questionCard(runId, question);
      let pendingId: string | null = null;
      const withdraw = () => {
        if (!pendingId) return;
        void settlePending(db, pendingId, {
          status: 'cancelled',
          decidedBy: 'policy',
          optionId: null,
        }).catch(() => undefined);
      };
      agentCancel.addEventListener('abort', withdraw, { once: true });
      try {
        const answer = await gate.raise(card, questionRequest(card), signal, (id) => {
          pendingId = id;
          if (agentCancel.aborted) withdraw();
        });
        return await reply(db, answer);
      } finally {
        agentCancel.removeEventListener('abort', withdraw);
      }
    },
  };
}
