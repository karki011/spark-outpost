import type {
  CapabilityOption,
  ModelSwitch,
  ProviderCapabilities,
  ProviderId,
} from '@spark-outpost/contracts';
import { agentDefinitions } from '../agents/acp/agents.ts';
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
  const session = await db.query<{ session_type: string }>(
    'SELECT session_type FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (session.rows[0]?.session_type === 'terminal')
    throw new BadRequestError('Use this session’s terminal to continue working.');
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
  const resolvesNames = agentDefinitions[settings.provider].resolvesModelNames === true;
  const kept = offered ?? (resolvesNames ? settings.model : null);
  const model = kept ?? capabilities?.defaultModel ?? null;
  return {
    provider: settings.provider,
    model,
    modelSwitch: droppedPin(settings.model, kept, model, capabilities),
    effort: settings.effort,
    permission: settings.permission,
    agentMode: settings.agentMode,
    level: settings.level,
    options: settings.options,
  };
}

function droppedPin(
  pinned: string | null,
  offered: string | null,
  used: string | null,
  capabilities: ProviderCapabilities | null,
): ModelSwitch | null {
  if (pinned === null || offered !== null || used === null || !capabilities?.access) return null;
  const label = capabilities.models.find((option) => option.id === used)?.label ?? used;
  return {
    provider: capabilities.provider,
    signIn: capabilities.access.signIn,
    from: { id: pinned, label: pinned },
    to: { id: used, label },
    learned: false,
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
