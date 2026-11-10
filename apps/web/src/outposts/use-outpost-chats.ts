import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary, OutpostMember } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { useReconciled } from './use-reconciled.ts';

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

function keepSameChats(
  kept: readonly ConversationSummary[],
  next: readonly ConversationSummary[],
): readonly ConversationSummary[] {
  const same = kept.length === next.length && kept.every((chat, index) => chat === next[index]);
  return same ? kept : next;
}

export function useMemberChats(
  chats: readonly ConversationSummary[],
  members: readonly OutpostMember[],
): readonly ConversationSummary[] {
  const picked = useMemo(() => {
    const ids = new Set(members.map((member) => member.conversationId));
    return chats.filter((chat) => ids.has(chat.id));
  }, [chats, members]);
  return useReconciled(picked, keepSameChats);
}
