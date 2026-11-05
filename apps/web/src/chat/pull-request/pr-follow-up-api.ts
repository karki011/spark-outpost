import {
  prRefreshResultSchema,
  prWatchListSchema,
  type PrRefreshResult,
  type PrWatchList,
} from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

export const prWatchesKey = (conversationId: string) =>
  [...queryKeys.conversation(conversationId), 'pull-requests'] as const;

export const prFollowUpApi = {
  get: (conversationId: string): Promise<PrWatchList> =>
    request(prWatchListSchema, `/conversations/${conversationId}/pull-requests`),
  refresh: (conversationId: string): Promise<PrWatchList> =>
    request(prWatchListSchema, `/conversations/${conversationId}/pull-requests/refresh`, {
      method: 'POST',
    }),
  refreshOne: (conversationId: string, watchId: string): Promise<PrRefreshResult> =>
    request(
      prRefreshResultSchema,
      `/conversations/${conversationId}/pull-requests/${watchId}/refresh`,
      { method: 'POST' },
    ),
};

export const prWatchesQuery = (conversationId: string) => ({
  queryKey: prWatchesKey(conversationId),
  queryFn: () => prFollowUpApi.get(conversationId),
});
