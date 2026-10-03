import type { Approval, CheckpointPayload } from '@spark-outpost/contracts';
import { clipText, commandFull, commandSummary, fileName } from './status-text.ts';

export interface PendingSummary {
  action: string;
  subject: string | null;
  code: boolean;
  full: string;
}

const APPROVE_COMMAND_CHARS = 28;
const QUESTION_CHARS = 48;

const PLAN: PendingSummary = {
  action: 'plan to review',
  subject: null,
  code: false,
  full: 'A plan to review',
};

function only(action: string): PendingSummary {
  return { action, subject: null, code: false, full: action };
}

function editSubject(paths: readonly string[]): string {
  const first = fileName(paths[0]!);
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first;
}

export function commandApproval(command: string): PendingSummary {
  return {
    action: 'approve',
    subject: commandSummary(command, APPROVE_COMMAND_CHARS),
    code: true,
    full: commandFull(command),
  };
}

export function approvalSummary(approval: Approval, heading: string): PendingSummary {
  const { payload } = approval;
  if (payload.plan) return PLAN;
  if (payload.sparkAction) return only(heading);
  if (approval.kind === 'execute' && payload.command) return commandApproval(payload.command);
  if (approval.kind === 'edit' && payload.paths.length > 0) {
    return {
      action: 'approve edit',
      subject: editSubject(payload.paths),
      code: true,
      full: payload.paths.join('\n'),
    };
  }
  return only(heading);
}

function question(text: string, more: number): PendingSummary {
  const shown = clipText(text, QUESTION_CHARS);
  return {
    action: more > 0 ? 'questions:' : 'question:',
    subject: more > 0 ? `${shown} +${more}` : shown,
    code: false,
    full: text,
  };
}

export function checkpointSummary(payload: CheckpointPayload, title: string): PendingSummary {
  const [first, ...rest] = payload.kind === 'clarify' ? payload.questions : [];
  if (first) return question(first.question, rest.length);
  if (payload.kind === 'clarify' && payload.question) return question(payload.question, 0);
  if (payload.kind === 'plan') return PLAN;
  return only(title);
}

export function summaryText(summary: PendingSummary): string {
  return summary.subject ? `${summary.action} ${summary.subject}` : summary.action;
}
