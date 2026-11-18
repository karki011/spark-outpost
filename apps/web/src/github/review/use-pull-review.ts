import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GithubReview } from '@spark-outpost/contracts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { githubKeys } from '../github-api.ts';
import { reviewApi, reviewKeys } from './review-api.ts';
import { isWorking, latestReview, reviewMark } from './review-model.ts';

const WORKING_POLL_MS = 3_000;

function replace(list: GithubReview[] | undefined, next: GithubReview): GithubReview[] {
  const rest = (list ?? []).filter((review) => review.id !== next.id);
  return [next, ...rest].toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function usePullReview(pull: string) {
  const queryClient = useQueryClient();
  const { remote, session } = useRemoteClient();
  const key = reviewKeys.pull(pull);
  const reviews = useQuery({
    queryKey: key,
    queryFn: () => reviewApi.list(pull),
    enabled: session !== undefined && !remote,
    refetchInterval: (query) => {
      const latest = latestReview(query.state.data);
      return latest && isWorking(latest.state) ? WORKING_POLL_MS : false;
    },
  });
  const latest = latestReview(reviews.data);
  const mark = reviewMark(reviews.data);
  const seenMark = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (mark === undefined) return;
    const previous = seenMark.current;
    seenMark.current = mark;
    if (previous === undefined || previous === mark) return;
    void queryClient.invalidateQueries({ queryKey: githubKeys.inbox });
  }, [mark, queryClient]);

  const keep = (review: GithubReview) =>
    queryClient.setQueryData<GithubReview[]>(key, (list) => replace(list, review));

  const start = useMutation({
    mutationFn: () => reviewApi.request(pull),
    onSuccess: keep,
  });
  const stop = useMutation({
    mutationFn: (id: string) => reviewApi.stop(id),
    onSuccess: keep,
  });

  const failure = start.error ?? stop.error;
  return {
    reviews,
    latest,
    busy: start.isPending || stop.isPending,
    actionError: failure ? failure.message : null,
    start: () => {
      stop.reset();
      start.mutate();
    },
    stop: (id: string) => {
      start.reset();
      stop.mutate(id);
    },
  };
}
