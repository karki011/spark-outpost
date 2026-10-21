import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AttentionItem, ConversationSummary } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { attentionApi, attentionKey } from '../attention/attention-api.ts';
import { useAttentionItems } from '../attention/use-attention.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { unseenSince } from './chat-blob.ts';

export function unreadSince(
  chat: ConversationSummary | undefined,
  items: readonly AttentionItem[],
): string | null {
  if (!chat) return null;
  const unread = items
    .filter((item) => item.conversationId === chat.id && !item.readAt)
    .map((item) => item.at);
  const since = unseenSince(chat);
  const all = since ? [...unread, since] : unread;
  return all.length > 0 ? all.toSorted().at(-1)! : null;
}

export function useMarkSeen(onScreenId: string | null, chats: readonly ConversationSummary[]) {
  const client = useQueryClient();
  const hidden = usePageHidden();
  const { items } = useAttentionItems();
  const marked = useRef<string | null>(null);
  const chat = onScreenId ? chats.find((each) => each.id === onScreenId) : undefined;
  const since = unreadSince(chat, items);
  const key = chat && since && !hidden ? `${chat.id}:${since}` : null;
  useEffect(() => {
    if (!key || !onScreenId || marked.current === key) return;
    marked.current = key;
    void attentionApi
      .readChat(onScreenId)
      .then(() =>
        Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
          client.invalidateQueries({ queryKey: attentionKey }),
        ]),
      )
      .catch(() => {
        marked.current = null;
      });
  }, [key, onScreenId, client]);
}
