import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GithubInbox, GithubInboxWindowDays } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { githubApi, githubKeys } from './github-api.ts';
import { hasUpdates, markSeen } from './github-model.ts';

const STALE_MS = 60_000;

export function useGithubInboxQuery(enabled = true) {
  return useQuery({
    queryKey: githubKeys.inbox,
    queryFn: () => githubApi.inbox(),
    staleTime: STALE_MS,
    enabled,
  });
}

export function useGithubUpdates(): boolean {
  const { remote, session } = useRemoteClient();
  const onMac = session !== undefined && !remote;
  const inbox = useGithubInboxQuery(onMac);
  return onMac && hasUpdates(inbox.data);
}

export function useGithubInbox() {
  const queryClient = useQueryClient();
  const inbox = useGithubInboxQuery();

  const refresh = useMutation({
    mutationFn: () => githubApi.inbox(true),
    onSuccess: (data) => queryClient.setQueryData(githubKeys.inbox, data),
  });

  const seen = useMutation({
    mutationFn: githubApi.seen,
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: githubKeys.inbox });
      queryClient.setQueryData<GithubInbox>(githubKeys.inbox, (current) =>
        markSeen(current, body.id, body.headSha),
      );
    },
    onSuccess: (data) => queryClient.setQueryData(githubKeys.inbox, data),
    onError: () => void queryClient.invalidateQueries({ queryKey: githubKeys.inbox }),
  });

  const windowDays = useMutation({
    mutationFn: (days: GithubInboxWindowDays) => githubApi.window(days),
    onMutate: async (days) => {
      await queryClient.cancelQueries({ queryKey: githubKeys.inbox });
      queryClient.setQueryData<GithubInbox>(githubKeys.inbox, (current) =>
        current ? { ...current, windowDays: days } : current,
      );
    },
    onSuccess: (data) => queryClient.setQueryData(githubKeys.inbox, data),
    onError: () => void queryClient.invalidateQueries({ queryKey: githubKeys.inbox }),
  });

  return { inbox, refresh, seen, windowDays };
}
