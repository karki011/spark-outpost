import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuilderChat } from '@spark-outpost/contracts';
import { builderApi, builderKeys } from './builder-api.ts';

const CLOSED_KEY = 'spark.builderDock.closed';

function closedChat(): string | null {
  try {
    return localStorage.getItem(CLOSED_KEY);
  } catch {
    return null;
  }
}

function rememberClosed(conversationId: string): void {
  try {
    localStorage.setItem(CLOSED_KEY, conversationId);
  } catch {
    return;
  }
}

export function useOngoingBuilder(remote: boolean, onOngoing: () => void): () => void {
  const client = useQueryClient();
  const key = builderKeys.current(null, null);
  const current = useQuery({
    queryKey: key,
    queryFn: () => builderApi.current(null, null),
    enabled: !remote,
  });
  const chat = current.data ?? null;
  const ongoing = chat !== null && !chat.doneAt && chat.conversationId !== closedChat();
  const offered = useRef(false);
  useEffect(() => {
    if (!ongoing || offered.current) return;
    offered.current = true;
    onOngoing();
  }, [ongoing, onOngoing]);
  return useCallback(() => {
    const shown = client.getQueryData<BuilderChat | null>(builderKeys.current(null, null));
    if (shown) rememberClosed(shown.conversationId);
  }, [client]);
}
