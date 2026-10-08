import type {
  AgentPick,
  CrewMember,
  ModelOption,
  ModelRouting,
  Orchestration,
} from '@spark-outpost/contracts';
import { shortLabel } from '../chat/composer/model-options.ts';

export function modelFamily(pick: Pick<AgentPick, 'model' | 'modelLabel'>): string | null {
  const label = pick.modelLabel ? shortLabel(pick.modelLabel) : pick.model;
  const words = label?.split(/[\s-]/).filter(Boolean) ?? [];
  return words.find((word) => /[a-z]/i.test(word)) ?? words[0] ?? null;
}

type CardLabels = readonly Pick<ModelOption, 'id' | 'label'>[];

function labelled(member: CrewMember, cards: CardLabels): Pick<AgentPick, 'model' | 'modelLabel'> {
  const card = cards.find((option) => option.id === member.model);
  return { model: member.model, modelLabel: member.modelLabel ?? card?.label ?? null };
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

export function autoThisTurn(
  orchestration: Orchestration | null,
  cards: CardLabels = [],
): string | null {
  if (!orchestration || orchestration.routing !== 'auto') return null;
  const member = workingMember(orchestration);
  return member ? modelFamily(labelled(member, cards)) : null;
}

export function chatModelName(
  routing: ModelRouting | undefined,
  picked: string | null,
  turns: readonly Orchestration[],
  cards: CardLabels = [],
): string | null {
  if (routing !== 'auto') return picked;
  const last = turns.findLast((turn) => workingMember(turn)?.startedAt);
  const member = last?.routing === 'auto' ? workingMember(last) : undefined;
  if (!member) return 'Auto';
  const { model, modelLabel } = labelled(member, cards);
  return modelLabel ? shortLabel(modelLabel) : (model ?? 'Auto');
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
