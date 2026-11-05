import { useMemo } from 'react';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  Approval,
  ConversationDetail,
  ConversationSummary,
  Project,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { providerName } from '../chat/provider-name.ts';
import { runStep } from '../chat/wait-label.ts';
import { conversationCrew } from '../crew/conversation-crew.ts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { isRunning } from '../conversations/row-state.ts';

const WATCHED_LIMIT = 8;
const NO_CHATS: ConversationSummary[] = [];
const NO_PROJECTS: Project[] = [];

export interface ChatAgent {
  id: string;
  name: string;
  role: string | null;
  provider: string | null;
  line: string | null;
  crew: CrewAgent[];
}

export function chatAgent(
  chat: ConversationSummary,
  detail: ConversationDetail | undefined,
): ChatAgent {
  const crew = conversationCrew(detail).filter((agent) => agent.id !== 'jev');
  const busy =
    crew.findLast((agent) => agent.state === 'working' || agent.state === 'thinking') ??
    crew.findLast((agent) => agent.state === 'waiting') ??
    crew.at(-1);
  const provider = chat.attention?.provider ?? chat.latestRun?.provider ?? busy?.provider ?? null;
  if (busy) {
    return {
      id: busy.id,
      name: busy.name,
      role: busy.role,
      provider: busy.provider,
      line: busy.line,
      crew,
    };
  }
  return {
    id: chat.latestRun?.id ?? chat.id,
    name: chat.attention?.agentName ?? (provider ? providerName(provider) : 'Spark'),
    role: null,
    provider,
    line: chat.latestRun ? runStep(chat.latestRun) : null,
    crew,
  };
}

export function pendingOf(detail: ConversationDetail): Approval[] {
  const checkpoints = Object.values(detail.orchestrations ?? {}).flatMap((orchestration) =>
    orchestration.pendingCheckpoint ? [orchestration.pendingCheckpoint] : [],
  );
  return [...detail.approvals, ...checkpoints];
}

function dataOf(results: UseQueryResult<ConversationDetail>[]) {
  return results.map((result) => result.data);
}

export function useIslandData(hidden: ReadonlySet<string>, extraIds: readonly string[]) {
  const query = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const all = query.data ?? NO_CHATS;
  const chats = useMemo(() => all.filter((chat) => !hidden.has(chat.id)), [all, hidden]);
  const watched = useMemo(() => {
    const ids = chats
      .filter((chat) => !chat.archivedAt && (chat.needsInput || isRunning(chat)))
      .map((chat) => chat.id);
    return [...new Set([...extraIds, ...ids])].slice(0, WATCHED_LIMIT);
  }, [chats, extraIds]);
  const details = useQueries({
    queries: watched.map((id) => ({
      queryKey: queryKeys.conversation(id),
      queryFn: () => api.getConversation(id),
    })),
    combine: dataOf,
  });
  const detailById = useMemo(() => {
    const map = new Map<string, ConversationDetail>();
    details.forEach((detail, index) => {
      if (detail) map.set(watched[index]!, detail);
    });
    return map;
  }, [details, watched]);
  const approvalsByChat = useMemo(
    () => new Map([...detailById].map(([id, detail]) => [id, pendingOf(detail)] as const)),
    [detailById],
  );
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    [projects.data],
  );
  return {
    loaded: query.data !== undefined,
    all,
    chats,
    detailById,
    approvalsByChat,
    projects: projects.data ?? NO_PROJECTS,
    projectNames,
  };
}
