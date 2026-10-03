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

export async function askTurnAutoWhy(place: AskTurnPlace): Promise<string | null> {
  const settings = await resolveChatSettings(place.db, place.conversationId).catch(() => null);
  if (!settings) return null;
  const mode = settings.provider === place.provider ? settings.agentMode : null;
  if (mode && LETS_THROUGH.has(modePosture(place.provider, mode, modeKind(place.modes, mode)))) {
    const label = place.modes.find((option) => option.id === mode)?.label ?? mode;
    return `${label} mode`;
  }
  return settings.level ? ASK_AUTO_WHY : null;
}
