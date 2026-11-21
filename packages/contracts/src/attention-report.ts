import { waitingLine } from './attention-line.ts';
import { alerting, type AttentionItem } from './attention-items.ts';
import type { ConversationSummary } from './conversations.ts';

export interface AttentionRequest {
  key: string;
  chatId: string;
  chat: string;
  title: string;
  body: string;
}

export interface AttentionReport {
  count: number;
  requests: AttentionRequest[];
}

export function attentionRequestTitle(chat: ConversationSummary): string {
  if (chat.outpost) return `@${chat.outpost.handle} needs you in ${chat.outpost.name}`;
  if (chat.parent) return `${chat.title} in ${chat.parent.title} needs you`;
  return `Spark needs you: ${chat.title}`;
}

export function attentionReport(
  chats: readonly ConversationSummary[],
  items: readonly AttentionItem[],
): AttentionReport {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const requests = items.filter(alerting).flatMap((item): AttentionRequest[] => {
    const chat = item.conversationId ? byId.get(item.conversationId) : undefined;
    if (!chat || chat.archivedAt) return [];
    return [
      {
        key: item.key,
        chatId: chat.id,
        chat: chat.title,
        title: attentionRequestTitle(chat),
        body: waitingLine(chat),
      },
    ];
  });
  return { count: new Set(requests.map((request) => request.chatId)).size, requests };
}
