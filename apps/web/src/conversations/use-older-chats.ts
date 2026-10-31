import { useCallback, useMemo, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { CHAT_LIST_PAGE, type ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';

type Pages = InfiniteData<ConversationSummary[], string>;
type ListChange = (list: ConversationSummary[] | undefined) => ConversationSummary[] | undefined;

const NO_CHATS: ConversationSummary[] = [];

export function patchOlderChats(client: QueryClient, change: ListChange): void {
  client.setQueriesData<Pages>({ queryKey: queryKeys.olderConversations }, (data) =>
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
  const [full, setFull] = useState(false);
  if (!full && head.length >= CHAT_LIST_PAGE) setFull(true);
  const cursor = head.at(-1)?.id ?? '';
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.olderConversations, cursor],
    queryFn: ({ pageParam }) => api.listConversationsAfter(pageParam),
    initialPageParam: cursor,
    placeholderData: keepPreviousData,
    getNextPageParam: (last) => (last.length >= CHAT_LIST_PAGE ? last.at(-1)?.id : undefined),
    enabled: asked && full && cursor !== '',
  });
  const pages = query.data?.pages;
  const chats = useMemo(() => (pages ? mergeChatPages(head, pages) : head), [head, pages]);
  const { fetchNextPage, refetch } = query;
  const started = pages !== undefined;
  const failedFirst = !started && query.isError;
  const more = useCallback(() => {
    if (started) void fetchNextPage();
    else if (failedFirst) void refetch();
    else setAsked(true);
  }, [started, failedFirst, fetchNextPage, refetch]);
  return {
    chats,
    hasMore: full && (!started || query.hasNextPage),
    loading: query.isFetching,
    failed: query.isError,
    more,
  };
}
