import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { CHAT_LIST_PAGE, type ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';

type Pages = InfiniteData<ConversationSummary[], string>;
type ListChange = (list: ConversationSummary[] | undefined) => ConversationSummary[] | undefined;

const NO_CHATS: ConversationSummary[] = [];

export function patchOlderChats(client: QueryClient, change: ListChange): void {
  client.setQueryData<Pages>(queryKeys.olderConversations, (data) =>
    data ? { ...data, pages: data.pages.map((page) => change(page) ?? page) } : data,
  );
}

export function mergeChatPages(
  head: readonly ConversationSummary[],
  pages: readonly (readonly ConversationSummary[])[],
): ConversationSummary[] {
  const seen = new Set(head.map((chat) => chat.id));
  const merged = [...head];
  for (const chat of pages.flat()) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    merged.push(chat);
  }
  return merged;
}

export function useOlderChats(data: ConversationSummary[] | undefined) {
  const head = data ?? NO_CHATS;
  const [asked, setAsked] = useState(false);
  const full = head.length >= CHAT_LIST_PAGE;
  const query = useInfiniteQuery({
    queryKey: queryKeys.olderConversations,
    queryFn: ({ pageParam }) => api.listConversationsAfter(pageParam),
    initialPageParam: head.at(-1)?.id ?? '',
    getNextPageParam: (last) => (last.length >= CHAT_LIST_PAGE ? last.at(-1)?.id : undefined),
    enabled: asked && full,
  });
  const pages = query.data?.pages;
  const chats = useMemo(() => (pages ? mergeChatPages(head, pages) : head), [head, pages]);
  const { fetchNextPage } = query;
  const started = pages !== undefined;
  const more = useCallback(() => {
    if (started) void fetchNextPage();
    else setAsked(true);
  }, [started, fetchNextPage]);
  return {
    chats,
    hasMore: full && (!started || query.hasNextPage),
    loading: query.isFetching,
    more,
  };
}
