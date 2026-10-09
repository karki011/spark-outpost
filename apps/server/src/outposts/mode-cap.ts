import type { ModePosture } from '@spark-outpost/contracts';

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

export function aboveLeadMode(lead: ModePosture, chat: ModePosture): boolean {
  return CHAT_RANK[chat] > LEAD_RANK[lead];
}

export function modeAboveLead(handle: string, leadHandle: string): string {
  return `@${handle} cannot start in a mode that asks less often than @${leadHandle}'s. Choose a mode that asks at least as often.`;
}

export function userChoseMode(proposed: string | null, requested: string | null): boolean {
  return requested !== proposed;
}

export interface ProposedChat {
  handle: string;
  posture: ModePosture;
}

export function proposedAboveOwnMode(handle: string): string {
  return `@${handle} cannot be proposed in a mode that asks less often than this chat's own. Propose a mode that asks at least as often, or leave the mode out.`;
}

export function proposalAboveLead(
  lead: ModePosture,
  chats: readonly ProposedChat[],
): string | null {
  const over = chats.find((chat) => aboveLeadMode(lead, chat.posture));
  return over ? proposedAboveOwnMode(over.handle) : null;
}
