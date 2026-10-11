import type { ModePosture } from './agent-modes.ts';

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
