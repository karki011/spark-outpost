import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { unseenSince } from './chat-blob.ts';

export function useMarkSeen(onScreenId: string | null, chats: readonly ConversationSummary[]) {
  const client = useQueryClient();
  const hidden = usePageHidden();
  const marked = useRef<string | null>(null);
  const chat = onScreenId ? chats.find((each) => each.id === onScreenId) : undefined;
  const since = chat ? unseenSince(chat) : null;
  const key = chat && since && !hidden ? `${chat.id}:${since}` : null;
  useEffect(() => {
    if (!key || !onScreenId || marked.current === key) return;
    marked.current = key;
    void api
      .markConversationSeen(onScreenId)
      .then(() => client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }))
      .catch(() => {
        marked.current = null;
      });
  }, [key, onScreenId, client]);
}
