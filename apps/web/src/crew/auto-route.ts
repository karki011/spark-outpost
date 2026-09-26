import type { AgentPick, CrewMember, Orchestration } from '@spark-outpost/contracts';
import { shortLabel } from '../chat/composer/model-options.ts';

export function modelFamily(pick: Pick<AgentPick, 'model' | 'modelLabel'>): string | null {
  const label = pick.modelLabel ? shortLabel(pick.modelLabel) : pick.model;
  const words = label?.split(/[\s-]/).filter(Boolean) ?? [];
  return words.find((word) => /[a-z]/i.test(word)) ?? words[0] ?? null;
}

function focusMember(crew: readonly CrewMember[]): CrewMember | undefined {
  return (
    crew.findLast(
      (member) => member.status === 'running' || member.status === 'awaiting_approval',
    ) ?? crew.findLast((member) => member.startedAt !== null)
  );
}

export function autoThisTurn(orchestration: Orchestration | null): string | null {
  if (!orchestration || orchestration.routing !== 'auto') return null;
  const member = focusMember(orchestration.crew);
  return member ? modelFamily(member) : null;
}

export function autoWouldHaveUsed(orchestration: Orchestration | null): string | null {
  if (!orchestration || orchestration.routing !== 'pinned') return null;
  const member = [...orchestration.crew].reverse().find((candidate) => candidate.autoWouldUse);
  const pick = member?.autoWouldUse;
  if (!member || !pick) return null;
  const would = modelFamily(pick);
  return would && would !== modelFamily(member) ? would : null;
}
