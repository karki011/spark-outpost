import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';

const NO_CHATS: ConversationSummary[] = [];

interface OutpostChats {
  chats: readonly ConversationSummary[];
  projectNames: Readonly<Record<string, string>>;
}

export function useOutpostChats(): OutpostChats {
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const chats = conversations.data ?? NO_CHATS;
  const projectNames = useMemo(
    () => Object.fromEntries((projects.data ?? []).map((project) => [project.id, project.name])),
    [projects.data],
  );
  return { chats, projectNames };
}
