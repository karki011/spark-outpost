import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { previewLive, type ChatPreview } from '@spark-outpost/contracts';
import { previewApi, previewKeys } from '../api/preview.ts';
import { showPreviewShell, useChatShells } from '../terminal/dock/shell-store.ts';

export function useChatPreview(chatId: string, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: previewKeys.chat(chatId),
    queryFn: () => previewApi.chat(chatId),
    enabled,
  });
  const accept = (next: ChatPreview) => queryClient.setQueryData(previewKeys.chat(chatId), next);
  const start = useMutation({ mutationFn: () => previewApi.start(chatId), onSuccess: accept });
  const stop = useMutation({ mutationFn: () => previewApi.stop(chatId), onSuccess: accept });
  return {
    preview: query.data ?? null,
    start,
    stop,
    error: start.error?.message ?? stop.error?.message ?? null,
  };
}

export function usePreviewDockTab(chatId: string): void {
  const { open } = useChatShells(chatId);
  const { preview } = useChatPreview(chatId, open);
  const live = previewLive(preview?.server);
  const seen = useRef({ live: false, open: false });
  useEffect(() => {
    const before = seen.current;
    seen.current = { live, open };
    if (live && open && (!before.live || !before.open)) showPreviewShell(chatId, false);
  }, [chatId, live, open]);
}
