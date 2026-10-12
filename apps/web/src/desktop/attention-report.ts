import type { ConversationSummary } from '@spark-outpost/contracts';
import { attention, rowState } from '../conversations/row-state.ts';
import type { AttentionReport, AttentionRequest } from './desktop-bridge.ts';

function requestKey(chat: ConversationSummary): string {
  return chat.attention?.approvalId ?? `chat:${chat.id}:${chat.latestRun?.id ?? ''}`;
}

function requestTitle(chat: ConversationSummary): string {
  if (chat.outpost) return `@${chat.outpost.handle} needs you in ${chat.outpost.name}`;
  return `Spark needs you: ${chat.title}`;
}

function request(chat: ConversationSummary): AttentionRequest {
  return {
    key: requestKey(chat),
    chatId: chat.id,
    title: requestTitle(chat),
    body: rowState(chat, false).sub,
  };
}

export function attentionReport(chats: readonly ConversationSummary[]): AttentionReport {
  const waiting = attention(chats, null);
  return { count: waiting.count, requests: waiting.others.map(request) };
}
