import { useQueries } from '@tanstack/react-query';
import type { ConversationSummary, ProviderId } from '@spark-outpost/contracts';
import { api, capabilitiesQuery, queryKeys } from '../api/client.ts';
import { modeInfo, type ModeInfo } from './mode-groups.ts';

const FRESH_MS = 30_000;

export function useChatModes(
  chats: readonly ConversationSummary[],
  enabled: boolean,
): ReadonlyMap<string, ModeInfo> {
  const sessions = chats.filter((chat) => chat.sessionType !== 'terminal');
  const details = useQueries({
    queries: sessions.map((chat) => ({
      queryKey: queryKeys.conversation(chat.id),
      queryFn: () => api.getConversation(chat.id),
      enabled,
      staleTime: FRESH_MS,
    })),
  });
  const providers = [
    ...new Set(
      details.flatMap((detail) =>
        detail.data?.settings.provider ? [detail.data.settings.provider] : [],
      ),
    ),
  ] as ProviderId[];
  const capabilities = useQueries({
    queries: providers.map((provider) => ({
      ...capabilitiesQuery(provider),
      enabled,
      retry: false,
    })),
  });
  const byProvider = new Map(
    providers.map((provider, index) => [provider, capabilities[index]?.data]),
  );
  const modes = new Map<string, ModeInfo>();
  sessions.forEach((chat, index) => {
    const settings = details[index]?.data?.settings;
    if (!settings?.provider) return;
    const caps = byProvider.get(settings.provider);
    if (caps) modes.set(chat.id, modeInfo(settings, caps));
  });
  return modes;
}
