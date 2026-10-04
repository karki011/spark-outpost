import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, QueuedMessage, QueueResponse } from '@spark-outpost/contracts';
import { ApiError, queryKeys } from '../../api/client.ts';
import { inOrder, movedIds, queuedItem } from './queue-model.ts';
import { queueApi } from './queue-api.ts';

const NO_QUEUE: QueuedMessage[] = [];

export interface ChatQueue {
  items: readonly QueuedMessage[];
  add: (content: string) => Promise<void>;
  edit: (id: string, content: string) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  sendNow: (id: string) => void;
  sendFirst: (content: string) => Promise<void>;
  error: string | null;
}

type Change =
  | { kind: 'add'; id: string; content: string }
  | { kind: 'edit'; id: string; content: string }
  | { kind: 'remove'; id: string }
  | { kind: 'order'; ids: string[] }
  | { kind: 'send'; id: string }
  | { kind: 'first'; id: string; content: string };

function call(conversationId: string, change: Change): Promise<QueueResponse> {
  switch (change.kind) {
    case 'add':
      return queueApi.add(conversationId, change.id, change.content);
    case 'edit':
      return queueApi.edit(conversationId, change.id, change.content);
    case 'remove':
      return queueApi.remove(conversationId, change.id);
    case 'order':
      return queueApi.order(conversationId, change.ids);
    case 'send':
      return queueApi.sendNow(conversationId, change.id);
    case 'first':
      return queueApi.sendFirst(conversationId, change.id, change.content);
  }
}

function applied(queue: readonly QueuedMessage[], change: Change): QueuedMessage[] {
  switch (change.kind) {
    case 'add':
      return queue.some((item) => item.id === change.id)
        ? [...queue]
        : [...queue, queuedItem(change.id, change.content, queue)];
    case 'edit':
      return queue.map((item) =>
        item.id === change.id ? { ...item, content: change.content } : item,
      );
    case 'remove':
    case 'send':
    case 'first':
      return queue.filter((item) => item.id !== change.id);
    case 'order':
      return inOrder(queue, change.ids);
  }
}

export function useChatQueue(
  conversationId: string,
  queue: readonly QueuedMessage[] | undefined,
): ChatQueue {
  const queryClient = useQueryClient();
  const key = queryKeys.conversation(conversationId);
  const setQueue = (next: (current: readonly QueuedMessage[]) => QueuedMessage[]) =>
    queryClient.setQueryData<ConversationDetail>(key, (detail) =>
      detail ? { ...detail, queue: next(detail.queue ?? NO_QUEUE) } : detail,
    );
  const mutation = useMutation({
    mutationKey: ['queue', conversationId],
    mutationFn: (change: Change) => call(conversationId, change),
    retry: (failures, error) => failures < 2 && error instanceof ApiError && error.status === 0,
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      setQueue((current) => applied(current, change));
    },
    onSuccess: (response, change) => {
      setQueue(() => response.queue);
      if (change.kind === 'add' || change.kind === 'send' || change.kind === 'first') {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const items = queue ?? NO_QUEUE;
  const { mutate, mutateAsync } = mutation;
  const error = mutation.error?.message ?? null;
  return useMemo(
    () => ({
      items,
      error,
      add: async (content) => {
        await mutateAsync({ kind: 'add', id: crypto.randomUUID(), content });
      },
      edit: (id, content) => mutate({ kind: 'edit', id, content }),
      remove: (id) => mutate({ kind: 'remove', id }),
      move: (id, delta) => {
        const ids = movedIds(items, id, delta);
        if (ids) mutate({ kind: 'order', ids });
      },
      sendNow: (id) => mutate({ kind: 'send', id }),
      sendFirst: async (content) => {
        await mutateAsync({ kind: 'first', id: crypto.randomUUID(), content });
      },
    }),
    [items, error, mutate, mutateAsync],
  );
}
