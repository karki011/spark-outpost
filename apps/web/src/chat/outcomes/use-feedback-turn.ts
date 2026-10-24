import { useQuery } from '@tanstack/react-query';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { isFeedbackTurn } from './feedback-host.ts';

export function useFeedbackTurn(conversationId: string, turnRunIds: readonly string[]): boolean {
  const shown = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => isFeedbackTurn(list.watches, turnRunIds),
    notifyOnChangeProps: ['data'],
  });
  return shown.data ?? false;
}
