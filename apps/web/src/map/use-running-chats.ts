import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { RunChanges } from '@spark-outpost/contracts';
import { approvalKeys, approvalsApi } from '../api/approvals.ts';
import { api, queryKeys } from '../api/client.ts';
import { activeChatsIn, type RunningChat } from './running-model.ts';

const NOT_LOADED: (RunChanges | undefined)[] = [];

export function useRunningChats(
  projectIds: readonly string[],
  enabled: boolean,
): {
  chats: RunningChat[];
  count: number;
} {
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const projectKey = projectIds.join(',');
  const active = useMemo(
    () => activeChatsIn(conversations.data ?? [], projectKey.split(',')),
    [conversations.data, projectKey],
  );
  const changes = useQueries({
    queries: active.map((chat) => ({
      queryKey: approvalKeys.changes(chat.latestRun!.id),
      queryFn: () => approvalsApi.changes(chat.latestRun!.id),
      enabled,
    })),
    combine: (results) => (results.length === 0 ? NOT_LOADED : results.map((r) => r.data)),
  });
  const chats = useMemo(
    () =>
      active.map((chat, index) => ({
        id: chat.id,
        title: chat.title,
        status: chat.latestRun!.status,
        projectId: chat.projectIds.find((id) => projectKey.split(',').includes(id))!,
        paths: (changes[index]?.files ?? [])
          .filter((file) => file.change !== 'deleted')
          .map((file) => file.path),
      })),
    [active, projectKey, changes],
  );
  return { chats, count: active.length };
}
