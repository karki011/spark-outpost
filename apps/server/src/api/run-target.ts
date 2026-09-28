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
    settings.model !== null &&
    (!capabilities || capabilities.models.some((model) => model.id === settings.model));
  return {
    provider: settings.provider,
    model: offered ? settings.model : (capabilities?.defaultModel ?? null),
    effort: settings.effort,
    permission: settings.permission,
    agentMode: settings.agentMode,
    level: settings.level,
    options: settings.options,
  };
}
