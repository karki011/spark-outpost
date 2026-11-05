import type {
  ConversationDetail,
  ProviderSetup,
  UpdateChatSettingsRequest,
} from '@spark-outpost/contracts';

export function carriedSettings(
  detail: ConversationDetail | undefined,
  providers: readonly ProviderSetup[],
): UpdateChatSettingsRequest | null {
  if (!detail || detail.conversation.teammate) return null;
  const { settings, conversation } = detail;
  const defaultModel = providers.find((provider) => provider.id === settings.provider)?.connection
    ?.model;
  const carried: UpdateChatSettingsRequest = {};
  if (conversation.projectIds.length > 0) carried.projectIds = [...conversation.projectIds];
  if (settings.provider) carried.provider = settings.provider;
  if (settings.model && settings.model !== defaultModel) carried.model = settings.model;
  if (settings.effort) carried.effort = settings.effort;
  if (settings.agentMode) carried.agentMode = settings.agentMode;
  if (settings.level) carried.level = settings.level;
  if (Object.keys(settings.options).length > 0) carried.options = settings.options;
  return carried;
}

export function isStartedChat(detail: ConversationDetail): boolean {
  return detail.messages.length > 0 || detail.runs.length > 0;
}
