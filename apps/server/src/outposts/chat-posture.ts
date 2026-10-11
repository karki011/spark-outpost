import { modeKind, modePosture, type ModePosture, type ProviderId } from '@spark-outpost/contracts';
import { getCapabilities, resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import { modeChoices, type ModeChoice } from './proposed-mode.ts';

export interface ChatPosture {
  provider: ProviderId | null;
  posture: ModePosture;
}

export async function providerModePosture(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId | null,
  mode: string | null,
): Promise<ModePosture> {
  if (!provider) return 'unknown';
  const capabilities = await getCapabilities(db, workspaceId, provider);
  return modePosture(provider, mode, modeKind(capabilities?.modes ?? [], mode));
}

export async function providerModeChoices(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId | null,
): Promise<ModeChoice[]> {
  if (!provider) return [];
  const capabilities = await getCapabilities(db, workspaceId, provider);
  return modeChoices(provider, capabilities?.modes ?? []);
}

export async function chatPosture(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<ChatPosture> {
  const settings = await resolveChatSettings(db, conversationId);
  return {
    provider: settings.provider,
    posture: await providerModePosture(db, workspaceId, settings.provider, settings.agentMode),
  };
}
