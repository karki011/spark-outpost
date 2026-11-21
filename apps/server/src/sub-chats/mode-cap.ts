import { aboveLeadMode, type ModePosture } from '@spark-outpost/contracts';

export function modeAboveLead(name: string, leadName: string): string {
  return `${name} cannot start in a mode that asks less often than ${leadName}'s. Choose a mode that asks at least as often.`;
}

export function userChoseMode(proposed: string | null, requested: string | null): boolean {
  return requested !== proposed;
}

export interface ProposedChat {
  name: string;
  posture: ModePosture;
}

export function proposedAboveOwnMode(name: string): string {
  return `${name} cannot be proposed in a mode that asks less often than this chat's own. Propose a mode that asks at least as often, or leave the mode out.`;
}

export function proposalAboveLead(
  lead: ModePosture,
  chats: readonly ProposedChat[],
): string | null {
  const over = chats.find((chat) => aboveLeadMode(lead, chat.posture));
  return over ? proposedAboveOwnMode(over.name) : null;
}
