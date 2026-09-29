import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { parseAppEvent, type AppEvent } from '@spark-outpost/contracts';
import { LIVE_ROOTS, isLiveQueryKey, mergeInvalidations } from './app-event-keys.ts';

const LIVE_STALE_MS = 5 * 60_000;
const FALLBACK_POLL_MS = 60_000;
const PAUSED_HINT_MS = 20_000;
const COALESCE_MS = 100;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

type Timer = ReturnType<typeof setTimeout>;

export function configureLiveQueries(client: QueryClient): void {
  for (const root of LIVE_ROOTS) client.setQueryDefaults([root], { staleTime: LIVE_STALE_MS });
}

function refreshLiveQueries(client: QueryClient, fetchedBefore = Infinity): void {
  void client.invalidateQueries({
    predicate: (query) =>
      isLiveQueryKey(query.queryKey) && query.state.dataUpdatedAt < fetchedBefore,
  });
}

export function useAppEvents(): { paused: boolean } {
  const queryClient = useQueryClient();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let stopped = false;
    let attempts = 0;
    let pending: AppEvent[] = [];
    let flushTimer: Timer | undefined;
    let retryTimer: Timer | undefined;
    let hintTimer: Timer | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;

    const flush = () => {
      flushTimer = undefined;
      const events = pending;
      pending = [];
      for (const invalidation of mergeInvalidations(events)) {
        void queryClient.invalidateQueries(invalidation);
      }
    };

    const markDown = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => refreshLiveQueries(queryClient), FALLBACK_POLL_MS);
      hintTimer = setTimeout(() => setPaused(true), PAUSED_HINT_MS);
    };

    const markUp = () => {
      clearInterval(fallbackTimer);
      clearTimeout(hintTimer);
      fallbackTimer = undefined;
      hintTimer = undefined;
      setPaused(false);
    };

    const connect = () => {
      const next = new EventSource('/api/events');
      source = next;
      next.onopen = () => {
        attempts = 0;
        markUp();
        refreshLiveQueries(queryClient, Date.now());
      };
      next.onmessage = (message: MessageEvent<string>) => {
        const event = parseAppEvent(message.data);
        if (!event) return;
        pending.push(event);
        flushTimer ??= setTimeout(flush, COALESCE_MS);
      };
      next.onerror = () => {
        markDown();
        if (next.readyState !== EventSource.CLOSED || stopped) return;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts);
        attempts += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(flushTimer);
      clearTimeout(retryTimer);
      clearTimeout(hintTimer);
      clearInterval(fallbackTimer);
    };
  }, [queryClient]);

  return { paused };
}
