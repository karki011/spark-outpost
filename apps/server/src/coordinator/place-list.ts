import { CHECKPOINT_OPTION, type ListPlacement, type PieceList } from '@spark-outpost/contracts';
import { COORD_CARD_PIECES } from '../advisor/policy.ts';
import { askCard, CheckpointTimeout, piecesCard } from '../orchestration/checkpoint.ts';
import type { ForcedPlacement, Session } from '../orchestration/session.ts';
import { placementFacts } from './assess.ts';
import { projectSettings } from './builder-env.ts';
import type { CheckedPiece } from './pieces-validate.ts';
import { placePieces } from './placement.ts';
import { coordinatorMode } from './shadow.ts';

export interface ListPlace {
  placement: ListPlacement;
  reason: string;
}

const IN_ORDER_REASON = 'pieces run in order, one Builder at a time';

const FORCED_LABEL: Record<ForcedPlacement, string> = {
  shared: 'the shared tree',
  worktree: 'worktrees',
};

export function forcedPlace(placement: ForcedPlacement): ListPlace {
  return {
    placement,
    reason: `placement forced to ${FORCED_LABEL[placement]} by COORDINATOR_PLACEMENT`,
  };
}

export async function chooseListPlace(
  s: Session,
  pieces: readonly CheckedPiece[],
): Promise<ListPlace> {
  if (coordinatorMode(s) !== 'parallel') return { placement: 'in_order', reason: IN_ORDER_REASON };
  const settings = await projectSettings(s.deps.db, s.lease.runId);
  if (!settings.parallel) {
    return { placement: 'in_order', reason: 'parallel pieces are off for this project' };
  }
  if (settings.slots < 2) {
    return { placement: 'in_order', reason: 'this project runs one Builder at a time' };
  }
  if (s.needsCopy) return { placement: 'in_order', reason: 'every piece runs in the task copy' };
  if (s.deps.forcedPlacement) return forcedPlace(s.deps.forcedPlacement);
  const placed = placePieces(
    pieces.map((piece) => ({
      key: piece.key,
      owned: piece.owned,
      dependsOn: piece.dependsOn,
      sizeEstimate: piece.sizeEstimate,
      size: piece.size,
      research: piece.research,
    })),
    await placementFacts(s),
  );
  return { placement: placed.placement, reason: placed.reason };
}

export function wantsListCard(s: Session, placement: ListPlacement, count: number): boolean {
  return s.input.level === 'balanced' && (placement !== 'in_order' || count >= COORD_CARD_PIECES);
}

function levelOf(
  key: string,
  deps: ReadonlyMap<string, readonly string[]>,
  seen: Map<string, number>,
): number {
  const known = seen.get(key);
  if (known !== undefined) return known;
  seen.set(key, 0);
  const level = 1 + Math.max(0, ...(deps.get(key) ?? []).map((dep) => levelOf(dep, deps, seen)));
  seen.set(key, level);
  return level;
}

export function widestLevel(pieces: readonly { key: string; dependsOn: readonly string[] }[]) {
  const deps = new Map(pieces.map((piece) => [piece.key, piece.dependsOn]));
  const seen = new Map<string, number>();
  const counts = new Map<number, number>();
  for (const piece of pieces) {
    const level = levelOf(piece.key, deps, seen);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

const WHERE: Record<ListPlacement, string> = {
  in_order: 'one at a time',
  shared: 'in the shared tree',
  worktree: 'in worktrees',
};

export function listQuestion(list: Pick<PieceList, 'placement' | 'pieces'>, slots: number) {
  const building = list.pieces.filter((piece) => !piece.research);
  const count = `${list.pieces.length} ${list.pieces.length === 1 ? 'piece' : 'pieces'}`;
  if (list.placement === 'in_order') return `Build in ${count}, one at a time?`;
  const atOnce = Math.min(slots, widestLevel(building));
  return `Build in ${count}, ${atOnce} at once ${WHERE[list.placement]}?`;
}

export type ListAnswer =
  { kind: 'build' } | { kind: 'in_order' } | { kind: 'revise'; note: string } | { kind: 'stop' };

export async function askPieceList(
  s: Session,
  list: PieceList,
  slots: number,
): Promise<ListAnswer> {
  const card = piecesCard(
    listQuestion(list, slots),
    list.placementReason,
    list.placement !== 'in_order',
  );
  const answer = await askCard(s, card);
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped' || answer.optionId === CHECKPOINT_OPTION.stop) {
    return { kind: 'stop' };
  }
  if (answer.optionId === CHECKPOINT_OPTION.buildInOrder) return { kind: 'in_order' };
  if (answer.optionId === CHECKPOINT_OPTION.editPlan && answer.note?.trim()) {
    return { kind: 'revise', note: answer.note.trim() };
  }
  return { kind: 'build' };
}
