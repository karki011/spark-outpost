import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { approvalKeys, approvalsApi } from '../api/approvals.ts';
import { api, queryKeys } from '../api/client.ts';

export interface ChatChanges {
  chat: ConversationSummary | null;
  projectId: string | null;
  paths: string[];
}

export function latestChatFor(
  chats: readonly ConversationSummary[],
  projectIds: readonly string[],
): ConversationSummary | null {
  return (
    chats
      .filter(
        (chat) =>
          !chat.archivedAt &&
          chat.latestRun !== null &&
          chat.projectIds.some((id) => projectIds.includes(id)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function useChatChanges(projectIds: readonly string[], enabled: boolean): ChatChanges {
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const chat = latestChatFor(conversations.data ?? [], projectIds);
  const runId = chat?.latestRun?.id ?? null;
  const changes = useQuery({
    queryKey: approvalKeys.changes(runId ?? ''),
    queryFn: () => approvalsApi.changes(runId!),
    enabled: enabled && runId !== null,
  });
  const paths = useMemo(
    () =>
      (changes.data?.files ?? [])
        .filter((file) => file.change !== 'deleted')
        .map((file) => file.path),
    [changes.data],
  );
  return {
    chat,
    projectId: chat?.projectIds.find((id) => projectIds.includes(id)) ?? null,
    paths,
  };
}
