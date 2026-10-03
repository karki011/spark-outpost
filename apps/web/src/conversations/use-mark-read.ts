import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';

export function useMarkRead(selectedId: string | null, chats: readonly ConversationSummary[]) {
  const client = useQueryClient();
  const marked = useRef<string | null>(null);
  const selected = chats.find((chat) => chat.id === selectedId);
  const key = selected?.unread ? `${selected.id}:${selected.latestRun?.id}` : null;
  useEffect(() => {
    if (!key || !selectedId || marked.current === key) return;
    marked.current = key;
    void api
      .markConversationRead(selectedId)
      .then(() => client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }));
  }, [key, selectedId, client]);
}
