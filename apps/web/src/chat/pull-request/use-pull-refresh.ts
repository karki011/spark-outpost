import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrWatch } from '@spark-outpost/contracts';
import { prFollowUpApi, prWatchesKey } from './pr-follow-up-api.ts';
import { NO_ANSWER_LINE, refreshProblemLine } from './pull-request-model.ts';

export interface PullRefresh {
  busy: boolean;
  problem: string | null;
  refresh(): void;
}

export function usePullRefresh(watch: Pick<PrWatch, 'id' | 'conversationId'>): PullRefresh {
  const queryClient = useQueryClient();
  const { conversationId, id } = watch;
  const press = useMutation({
    mutationFn: () => prFollowUpApi.refreshOne(conversationId, id),
    onSuccess: (result) => {
      queryClient.setQueryData(prWatchesKey(conversationId), { watches: result.watches });
    },
  });
  const answered = press.data?.problem ? refreshProblemLine(press.data.problem) : null;
  return {
    busy: press.isPending,
    problem: press.isPending ? null : press.isError ? NO_ANSWER_LINE : answered,
    refresh: () => {
      if (!press.isPending) press.mutate();
    },
  };
}
