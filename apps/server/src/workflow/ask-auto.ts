import { modeKind, modePosture, type AgentModeOption } from '@spark-outpost/contracts';
import { ASK_AUTO_WHY } from '../approvals/decide.ts';
import { resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';

export interface AskTurnPlace {
  db: Db;
  conversationId: string;
  provider: string;
  modes: readonly AgentModeOption[];
}

const LETS_THROUGH = new Set(['auto', 'full_access']);

export function chosenModeWhy(
  provider: string,
  mode: string | null,
  modes: readonly AgentModeOption[],
): string | null {
  if (!mode || !LETS_THROUGH.has(modePosture(provider, mode, modeKind(modes, mode)))) return null;
  const label = modes.find((option) => option.id === mode)?.label ?? mode;
  return `${label} mode`;
}

export async function askTurnAutoWhy(place: AskTurnPlace): Promise<string | null> {
  const settings = await resolveChatSettings(place.db, place.conversationId).catch(() => null);
  if (!settings) return null;
  const mode = settings.provider === place.provider ? settings.agentMode : null;
  const chosen = chosenModeWhy(place.provider, mode, place.modes);
  if (chosen) return chosen;
  return settings.level ? ASK_AUTO_WHY : null;
}
