import type { ConversationSummary, QuickAnswer } from '@spark-outpost/contracts';

export interface RowAnswer extends QuickAnswer {
  approvalId: string;
}

export function rowAnswer(chat: ConversationSummary): RowAnswer | null {
  const attention = chat.attention;
  if (chat.archivedAt || chat.sessionType === 'terminal' || !chat.needsInput) return null;
  if (!attention || attention.kind !== 'permission' || attention.prFeedback) return null;
  if (!attention.approvalId || !attention.quick) return null;
  return { approvalId: attention.approvalId, ...attention.quick };
}

export function answeredChat(chat: ConversationSummary): ConversationSummary {
  const run = chat.latestRun;
  return {
    ...chat,
    needsInput: false,
    attention: null,
    waitingSince: null,
    latestRun: run && run.status === 'awaiting_approval' ? { ...run, status: 'running' } : run,
  };
}
