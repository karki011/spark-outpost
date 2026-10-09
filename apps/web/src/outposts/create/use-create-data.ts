import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  DEFAULT_INVOLVEMENT_LEVEL,
  defaultModeFor,
  type ChatSettings,
  type ConversationSummary,
  type InvolvementLevel,
  type Project,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { api, CAPABILITIES_STALE_MS, capabilitiesQuery, queryKeys } from '../../api/client.ts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { setupApi, setupKey } from '../../api/setup.ts';
import { useOutpostChats } from '../use-outpost-chats.ts';
import type { AgentChoice, ChatDraft } from './create-draft.ts';
import { agentView, type AgentView } from './create-labels.ts';

export interface CreateData {
  chats: readonly ConversationSummary[];
  projects: readonly Project[];
  projectNames: Readonly<Record<string, string>>;
  providers: ProviderSetup[];
  defaults: AgentChoice;
  level: InvolvementLevel;
  capabilitiesOf: (provider: ProviderId) => ProviderCapabilities | undefined;
  loadingOf: (provider: ProviderId) => boolean;
  agentOf: (chat: ChatDraft) => AgentView | null;
}

const NO_PROVIDERS: ProviderSetup[] = [];
export const NO_AGENT: AgentChoice = { provider: null, model: null, agentMode: null };

export function choiceOf(settings: ChatSettings | undefined): AgentChoice {
  if (!settings?.provider) return NO_AGENT;
  return {
    provider: settings.provider,
    model: settings.routing === 'auto' ? null : settings.model,
    agentMode: settings.agentMode,
  };
}

export function defaultMode(
  provider: ProviderId,
  capabilities: ProviderCapabilities | undefined,
): string | null {
  return capabilities?.defaultMode ?? defaultModeFor(provider);
}

export type CreateBase = Omit<CreateData, 'agentOf'>;

export function useCreateBase(): CreateBase | null {
  const { chats, projectNames } = useOutpostChats();
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const defaults = useQuery({ queryKey: ['chat-defaults'], queryFn: api.getChatDefaults });
  const providers = useMemo(
    () => setup.data?.providers.filter((provider) => provider.connection) ?? NO_PROVIDERS,
    [setup.data],
  );
  const capabilities = useQueries({
    queries: providers.map((provider) => ({
      ...capabilitiesQuery(provider.id),
      staleTime: CAPABILITIES_STALE_MS,
    })),
  });
  if (!conversations.data || !projects.data || !setup.data || !defaults.data) return null;
  const queryOf = (provider: ProviderId) =>
    capabilities[providers.findIndex((entry) => entry.id === provider)];
  return {
    chats,
    projects: projects.data,
    projectNames,
    providers,
    defaults: choiceOf(defaults.data),
    level: defaults.data.level ?? DEFAULT_INVOLVEMENT_LEVEL,
    capabilitiesOf: (provider) => queryOf(provider)?.data,
    loadingOf: (provider) => queryOf(provider)?.isFetching ?? false,
  };
}

export function useCreateData(base: CreateBase, pickedChatIds: readonly string[]): CreateData {
  const settings = useQueries({
    queries: pickedChatIds.map((id) => ({
      queryKey: queryKeys.conversation(id),
      queryFn: () => api.getConversation(id),
    })),
  });
  const settingsOf = (chatId: string | null) =>
    chatId === null ? undefined : settings[pickedChatIds.indexOf(chatId)]?.data?.settings;
  return {
    ...base,
    agentOf: (chat) => {
      const choice = chat.kind === 'new' ? chat : choiceOf(settingsOf(chat.chatId));
      return agentView(choice, choice.provider ? base.capabilitiesOf(choice.provider) : undefined);
    },
  };
}
