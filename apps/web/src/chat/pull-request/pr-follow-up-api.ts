import { prWatchListSchema, type PrWatchList } from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

export const prWatchesKey = (conversationId: string) =>
  [...queryKeys.conversation(conversationId), 'pull-requests'] as const;

export const prFollowUpApi = {
  get: (conversationId: string): Promise<PrWatchList> =>
    request(prWatchListSchema, `/conversations/${conversationId}/pull-requests`),
};
