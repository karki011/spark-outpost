import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  alertingChats,
  type AttentionItem,
  type AttentionList,
  type AttentionMark,
} from '@spark-outpost/contracts';
import { attentionApi, attentionKey } from './attention-api.ts';

const NO_ITEMS: AttentionItem[] = [];

export function useAttentionItems(): { items: readonly AttentionItem[]; loaded: boolean } {
  const query = useQuery({ queryKey: attentionKey, queryFn: attentionApi.list });
  return { items: query.data?.items ?? NO_ITEMS, loaded: query.data !== undefined };
}

export function useAlertingChats(): ReadonlySet<string> {
  const { items } = useAttentionItems();
  return useMemo(() => alertingChats(items), [items]);
}

export function markedItem(item: AttentionItem, mark: AttentionMark, at: string): AttentionItem {
  return {
    ...item,
    readAt: item.readAt ?? at,
    setAsideAt: mark === 'set-aside' ? (item.setAsideAt ?? at) : item.setAsideAt,
    dismissedAt: mark === 'dismiss' ? (item.dismissedAt ?? at) : item.dismissedAt,
  };
}

interface MarkInput {
  keys: readonly string[];
  mark: AttentionMark;
}

function patchItems(
  list: AttentionList | undefined,
  change: (items: AttentionItem[]) => AttentionItem[],
): AttentionList | undefined {
  return list ? { items: change(list.items) } : list;
}

export function useHandledAttention() {
  const client = useQueryClient();
  return useCallback(
    (key: string) => {
      client.setQueryData<AttentionList>(attentionKey, (list) =>
        patchItems(list, (items) => items.filter((item) => item.key !== key)),
      );
      void client.invalidateQueries({ queryKey: attentionKey });
    },
    [client],
  );
}

export function useReadChat() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: attentionApi.readChat,
    onMutate: async (conversationId: string) => {
      await client.cancelQueries({ queryKey: attentionKey });
      const at = new Date().toISOString();
      client.setQueryData<AttentionList>(attentionKey, (list) =>
        patchItems(list, (items) =>
          items.map((item) =>
            item.conversationId === conversationId ? markedItem(item, 'read', at) : item,
          ),
        ),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: attentionKey }),
  });
  return mutation.mutate;
}

export function useMarkAttention() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ keys, mark }: MarkInput) =>
      Promise.all(keys.map((key) => attentionApi.mark(key, mark))),
    onMutate: async ({ keys, mark }) => {
      await client.cancelQueries({ queryKey: attentionKey });
      const at = new Date().toISOString();
      const wanted = new Set(keys);
      client.setQueryData<AttentionList>(attentionKey, (list) =>
        list
          ? {
              items: list.items.map((item) =>
                wanted.has(item.key) ? markedItem(item, mark, at) : item,
              ),
            }
          : list,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: attentionKey }),
  });
  const { mutate } = mutation;
  return useCallback(
    (keys: readonly string[], mark: AttentionMark) => {
      if (keys.length > 0) mutate({ keys, mark });
    },
    [mutate],
  );
}
