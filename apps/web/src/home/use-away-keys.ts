import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HOME_SEEN_DWELL_MS, type AttentionItem } from '@spark-outpost/contracts';
import { homeApi, homeKeys } from './home-api.ts';
import { awayKeys } from './since-model.ts';

const NONE: ReadonlySet<string> = new Set();

export function useAwayKeys(
  items: readonly AttentionItem[],
  loaded: boolean,
  now: number,
): { keys: ReadonlySet<string>; ready: boolean } {
  const client = useQueryClient();
  const seen = useQuery({
    queryKey: homeKeys.seen,
    queryFn: homeApi.seen,
    gcTime: 0,
    retry: false,
  });
  const markSeen = useMutation({
    mutationFn: homeApi.markSeen,
    onSuccess: (data) => client.setQueryData(homeKeys.seen, data),
  });
  const settled = seen.isSuccess || seen.isError;
  const [keys, setKeys] = useState<ReadonlySet<string> | null>(null);
  if (keys === null && loaded && settled) {
    setKeys(seen.isSuccess ? awayKeys(items, seen.data.seenAt, now) : NONE);
  }
  const ready = keys !== null;
  const { mutate } = markSeen;
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => mutate(), HOME_SEEN_DWELL_MS);
    return () => clearTimeout(timer);
  }, [ready, mutate]);
  return { keys: keys ?? NONE, ready };
}
