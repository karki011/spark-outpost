import { defaultModeFor, modeKind, modePosture, type ModePosture } from './agent-modes.ts';
import type { ProviderCapabilities } from './chat-settings.ts';

const CHAT_RANK: Readonly<Record<ModePosture, number>> = {
  read_only: 0,
  asks: 1,
  denies: 1,
  edits: 2,
  auto: 3,
  full_access: 4,
  unknown: 4,
};

const LEAD_RANK: Readonly<Record<ModePosture, number>> = { ...CHAT_RANK, unknown: 1 };

export function chatModeRank(posture: ModePosture): number {
  return CHAT_RANK[posture];
}

export function leadModeLimit(lead: ModePosture): number {
  return LEAD_RANK[lead];
}

export function aboveLeadMode(lead: ModePosture, chat: ModePosture): boolean {
  return chatModeRank(chat) > leadModeLimit(lead);
}

function rankOf(
  provider: string,
  mode: string | null,
  capabilities: ProviderCapabilities | undefined,
): number {
  return chatModeRank(modePosture(provider, mode, modeKind(capabilities?.modes ?? [], mode)));
}

export function cappedMode(
  provider: string,
  wanted: string | null,
  capabilities: ProviderCapabilities | undefined,
  lead: ModePosture,
): string | null {
  const limit = leadModeLimit(lead);
  const effective = wanted ?? capabilities?.defaultMode ?? defaultModeFor(provider);
  if (rankOf(provider, effective, capabilities) <= limit) return wanted;
  const allowed = (capabilities?.modes ?? [])
    .map((mode) => ({ id: mode.id, rank: rankOf(provider, mode.id, capabilities) }))
    .filter((mode) => mode.rank <= limit);
  const highest = Math.max(...allowed.map((mode) => mode.rank));
  return allowed.find((mode) => mode.rank === highest)?.id ?? wanted;
}
