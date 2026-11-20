import { shownChatTitle, type ConversationSummary } from '@spark-outpost/contracts';
import { workflowsApi } from './workflows-api.ts';

export const PICKABLE_MAX = 50;

export function pickableChats(
  chats: readonly ConversationSummary[],
  query: string,
): ConversationSummary[] {
  const needle = query.trim().toLowerCase();
  return chats
    .filter(
      (chat) =>
        chat.archivedAt === null &&
        (chat.sessionType ?? 'chat') === 'chat' &&
        shownChatTitle(chat.title).toLowerCase().includes(needle),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, PICKABLE_MAX);
}

export function runInChatsLabel(count: number): string {
  if (count === 0) return 'Run';
  return `Run in ${count} ${count === 1 ? 'chat' : 'chats'}`;
}

export type ChatStart = { chatId: string; ok: true } | { chatId: string; ok: false; error: string };

type Start = (chatId: string) => Promise<unknown>;

export async function startInChats(
  workflowId: string,
  chatIds: readonly string[],
  message: string,
  start: Start = (conversationId) =>
    workflowsApi.startRun(workflowId, { conversationId, message: message.trim() }),
): Promise<ChatStart[]> {
  const settled = await Promise.allSettled(chatIds.map((chatId) => start(chatId)));
  return settled.map((result, index): ChatStart => {
    const chatId = chatIds[index]!;
    if (result.status === 'fulfilled') return { chatId, ok: true };
    const error = result.reason instanceof Error ? result.reason.message : 'It didn’t start.';
    return { chatId, ok: false, error };
  });
}
