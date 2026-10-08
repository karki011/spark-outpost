import type { AgentPick, CrewMember, ModelRouting, Orchestration } from '@spark-outpost/contracts';
import { shortLabel } from '../chat/composer/model-options.ts';

export function modelFamily(pick: Pick<AgentPick, 'model' | 'modelLabel'>): string | null {
  const label = pick.modelLabel ? shortLabel(pick.modelLabel) : pick.model;
  const words = label?.split(/[\s-]/).filter(Boolean) ?? [];
  return words.find((word) => /[a-z]/i.test(word)) ?? words[0] ?? null;
}

export function workingMember(orchestration: Orchestration): CrewMember | undefined {
  const workers = orchestration.crew.filter(
    (member) => member.role !== 'critic' && member.provider === orchestration.provider,
  );
  return (
    workers.findLast(
      (member) => member.status === 'running' || member.status === 'awaiting_approval',
    ) ?? workers.findLast((member) => member.startedAt !== null)
  );
}

export function autoThisTurn(orchestration: Orchestration | null): string | null {
  if (!orchestration || orchestration.routing !== 'auto') return null;
  const member = workingMember(orchestration);
  return member ? modelFamily(member) : null;
}

export function chatModelName(
  routing: ModelRouting | undefined,
  picked: string | null,
  turns: readonly Orchestration[],
): string | null {
  if (routing !== 'auto') return picked;
  const last = turns.findLast((turn) => workingMember(turn)?.startedAt);
  const member = last?.routing === 'auto' ? workingMember(last) : undefined;
  if (!member) return 'Auto';
  return member.modelLabel ? shortLabel(member.modelLabel) : (member.model ?? 'Auto');
}

export function builderRouteNote(orchestration: Orchestration | null): string | null {
  const builder = orchestration?.crew.findLast((member) => member.role === 'builder');
  const note = builder?.routeNote;
  return note ? note.charAt(0).toUpperCase() + note.slice(1) : null;
}

export function autoWouldHaveUsed(orchestration: Orchestration | null): string | null {
  if (!orchestration) return null;
  const member = [...orchestration.crew].reverse().find((candidate) => candidate.autoWouldUse);
  const pick = member?.autoWouldUse;
  if (!member || !pick) return null;
  const would = modelFamily(pick);
  return would && would !== modelFamily(member) ? would : null;
}
