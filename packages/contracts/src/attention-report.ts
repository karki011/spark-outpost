import { needsInput, waitingLine } from './attention-line.ts';
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

function requestKey(chat: ConversationSummary): string {
  return chat.attention?.approvalId ?? `chat:${chat.id}:${chat.latestRun?.id ?? ''}`;
}

function requestTitle(chat: ConversationSummary): string {
  if (chat.outpost) return `@${chat.outpost.handle} needs you in ${chat.outpost.name}`;
  return `Spark needs you: ${chat.title}`;
}

export function attentionReport(chats: readonly ConversationSummary[]): AttentionReport {
  const waiting = chats.filter((chat) => !chat.archivedAt && needsInput(chat));
  return {
    count: waiting.length,
    requests: waiting.map((chat) => ({
      key: requestKey(chat),
      chatId: chat.id,
      chat: chat.title,
      title: requestTitle(chat),
      body: waitingLine(chat),
    })),
  };
}
