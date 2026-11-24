import type { QueryClient } from '@tanstack/react-query';
import type { ConversationDetail, ConversationRuns } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { invalidateLive } from './invalidate-live.ts';

type FetchRuns = (conversationId: string) => Promise<ConversationRuns>;

const refreshing = new WeakMap<QueryClient, Map<string, { again: boolean }>>();

function refreshingOf(client: QueryClient): Map<string, { again: boolean }> {
  const known = refreshing.get(client);
  if (known) return known;
  const created = new Map<string, { again: boolean }>();
  refreshing.set(client, created);
  return created;
}

export function withRuns(detail: ConversationDetail, slice: ConversationRuns): ConversationDetail {
  const fresh = new Map(slice.runs.map((run) => [run.id, run]));
  const { advisors } = detail.usageTotals;
  const next: ConversationDetail = {
    ...detail,
    runs: detail.runs.map((run) => fresh.get(run.id) ?? run),
    usageTotals: { ...slice.usageTotals, ...(advisors ? { advisors } : {}) },
  };
  if (slice.promptCache) next.promptCache = slice.promptCache;
  else delete next.promptCache;
  return next;
}

export function refreshChatRuns(
  client: QueryClient,
  conversationId: string,
  fetchRuns: FetchRuns = api.getConversationRuns,
): void {
  const queryKey = queryKeys.conversation(conversationId);
  const query = client.getQueryCache().find<ConversationDetail>({ queryKey, exact: true });
  if (!query || query.state.data === undefined) return;
  if (!query.isActive()) {
    void client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
    return;
  }
  const waiting = refreshingOf(client);
  const running = waiting.get(conversationId);
  if (running) {
    running.again = true;
    return;
  }
  const mine = { again: false };
  waiting.set(conversationId, mine);
  const read = query.state.data;
  const finish = (retry: boolean) => {
    waiting.delete(conversationId);
    if (retry || mine.again) refreshChatRuns(client, conversationId, fetchRuns);
  };
  fetchRuns(conversationId).then(
    (slice) => {
      const state = client.getQueryState<ConversationDetail>(queryKey);
      if (!state) return finish(false);
      if (state.fetchStatus === 'fetching') {
        if (!query.promise) return finish(false);
        const settled = () => finish(true);
        void query.promise.then(settled, settled);
        return;
      }
      if (state.isInvalidated || !query.isActive()) {
        waiting.delete(conversationId);
        invalidateLive(client, { queryKey, exact: true });
        return;
      }
      if (state.data !== read) return finish(true);
      client.setQueryData<ConversationDetail>(queryKey, (detail) =>
        detail ? withRuns(detail, slice) : detail,
      );
      finish(false);
    },
    () => {
      waiting.delete(conversationId);
      invalidateLive(client, { queryKey, exact: true });
    },
  );
}
