import type { Approval, RailFlag } from '@spark-outpost/contracts';
import type { CardMark } from '../rows/card-place.ts';

export type TurnCard =
  | { kind: 'approval'; id: string; time: number; approval: Approval }
  | { kind: 'flag'; id: string; time: number; flag: RailFlag };

export interface TurnCardsInput {
  approvals: readonly Approval[];
  flags: readonly RailFlag[];
  approvalAt: Readonly<Record<string, number>>;
  publishFrom: number | null;
}

export interface TurnCards {
  marks: CardMark[];
  publish: TurnCard[];
  byId: ReadonlyMap<string, TurnCard>;
}

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function allCards(approvals: readonly Approval[], flags: readonly RailFlag[]): TurnCard[] {
  const byId = new Map<string, TurnCard>();
  for (const approval of approvals) {
    const card = { kind: 'approval' as const, id: approval.id, approval };
    byId.set(approval.id, { ...card, time: timeOf(approval.createdAt) });
  }
  for (const flag of flags) {
    byId.set(flag.id, { kind: 'flag', id: flag.id, time: timeOf(flag.createdAt), flag });
  }
  return [...byId.values()];
}

export function turnCards({
  approvals,
  flags,
  approvalAt,
  publishFrom,
}: TurnCardsInput): TurnCards {
  const cards = allCards(approvals, flags);
  const inPublish = (card: TurnCard) => publishFrom !== null && card.time > publishFrom;
  return {
    marks: cards
      .filter((card) => !inPublish(card))
      .map((card) => ({ id: card.id, time: card.time, textOffset: approvalAt[card.id] })),
    publish: cards.filter(inPublish).sort((left, right) => left.time - right.time),
    byId: new Map(cards.map((card) => [card.id, card])),
  };
}
