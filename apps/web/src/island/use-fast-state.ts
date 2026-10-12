import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompanionFeed } from '../companion/companion-model.ts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import type { FastState } from './ask-fast-path.ts';

export function useFastState(feed: CompanionFeed, asking: boolean): FastState {
  const spend = useQuery({
    queryKey: homeKeys.spend('today'),
    queryFn: () => homeApi.spend('today'),
    enabled: asking,
  });
  const spendToday = spend.data?.costUsd ?? null;
  return useMemo(
    () => ({
      waiting: feed.needs.map((item) => ({
        id: item.chat.id,
        title: item.chat.title,
        detail: item.sub,
      })),
      running: feed.running.map((item) => ({
        id: item.chat.id,
        title: item.chat.title,
        detail: item.step,
      })),
      spendToday,
    }),
    [feed, spendToday],
  );
}
