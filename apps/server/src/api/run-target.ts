import type { CapabilityOption, ProviderId } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import type { Db } from '../persistence/db.ts';
import type { RunTarget } from '../persistence/conversations.ts';
import {
  ConversationMissingError,
  draftChatSettings,
  getCapabilities,
  resolveChatSettings,
} from '../persistence/chat-settings.ts';
import { BadRequestError } from './validation.ts';

export interface RunTargetDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string | undefined;
}

export async function resolveRunTarget(
  { db, workspaceId, fixedRunProvider }: RunTargetDeps,
  conversationId: string,
): Promise<RunTarget> {
  if (fixedRunProvider) return { provider: fixedRunProvider };
  const settings = await resolveChatSettings(db, conversationId).catch((error: unknown) => {
    if (error instanceof ConversationMissingError) return draftChatSettings(db, workspaceId);
    throw error;
  });
  if (!settings.provider) {
    throw new BadRequestError('Connect an AI provider before sending a message.');
  }
  const capabilities = await getCapabilities(db, workspaceId, settings.provider);
  const offered =
    settings.model === null || !capabilities
      ? settings.model
      : offeredPin(settings.provider, settings.model, capabilities.models);
  return {
    provider: settings.provider,
    model: offered ?? capabilities?.defaultModel ?? null,
    effort: settings.effort,
    permission: settings.permission,
    agentMode: settings.agentMode,
    level: settings.level,
    options: settings.options,
  };
}

function offeredPin(
  provider: ProviderId,
  pinned: string,
  models: readonly CapabilityOption[],
): string | null {
  if (models.some((model) => model.id === pinned)) return pinned;
  const card = cardFor({ id: pinned }, provider);
  if (!card) return null;
  return models.find((model) => cardFor({ id: model.id }, provider)?.id === card.id)?.id ?? null;
}
