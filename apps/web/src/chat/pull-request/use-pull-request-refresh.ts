import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prFollowUpApi, prWatchesKey } from './pr-follow-up-api.ts';

const FIRST_WAIT_MS = 60_000;
const LONGEST_WAIT_MS = 10 * 60_000;

export function usePullRequestRefresh(conversationId: string, busy: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let wait = FIRST_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const refresh = () => {
      prFollowUpApi
        .refresh(conversationId)
        .then((list) => {
          if (!stopped) queryClient.setQueryData(prWatchesKey(conversationId), list);
        })
        .catch(() => undefined);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') refresh();
        wait = Math.min(wait * 2, LONGEST_WAIT_MS);
        schedule();
      }, wait);
    };
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      wait = FIRST_WAIT_MS;
      refresh();
      schedule();
    };
    refresh();
    schedule();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [conversationId, busy, queryClient]);
}
