import type { ConversationSummary } from '@spark-outpost/contracts';

interface FinishedRun {
  kind: 'done' | 'failed';
  chatId: string;
  runId: string;
}

export function memberNeedsYou(
  moment: FinishedRun,
  chats: readonly ConversationSummary[],
): string | null {
  if (moment.kind !== 'done') return null;
  const chat = chats.find((candidate) => candidate.id === moment.chatId);
  if (!chat?.outpost || chat.latestRun?.id !== moment.runId) return null;
  if (!chat.latestRun.needsYou?.trim()) return null;
  return `@${chat.outpost.handle} needs you in ${chat.outpost.name}.`;
}
