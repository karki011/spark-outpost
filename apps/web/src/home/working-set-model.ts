import {
  freshUpdate,
  type AttentionItem,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import type { NeedItem } from './home-model.ts';

export interface ReviewItem {
  chat: ConversationSummary;
  clean: boolean;
  line: string;
  attentionKey: string | null;
}

export function reviewItems(
  need: readonly NeedItem[],
  attention: readonly AttentionItem[],
  chats: readonly ConversationSummary[],
): ReviewItem[] {
  const byId = new Map(chats.filter((chat) => !chat.archivedAt).map((chat) => [chat.id, chat]));
  const clean = attention
    .filter(
      (item) =>
        item.kind === 'pr-clean' &&
        freshUpdate(item) &&
        item.conversationId !== null &&
        byId.has(item.conversationId),
    )
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((item): ReviewItem => ({
      chat: byId.get(item.conversationId!)!,
      clean: true,
      line: 'PR is clean · ready to merge',
      attentionKey: item.key,
    }));
  const seen = new Set(clean.map((entry) => entry.chat.id));
  const finished = need
    .filter((item) => item.tone === 'done' && !seen.has(item.chat.id))
    .map((item): ReviewItem => ({
      chat: item.chat,
      clean: false,
      line: item.sub || 'Finished · open to review',
      attentionKey: null,
    }));
  return [...clean, ...finished];
}
