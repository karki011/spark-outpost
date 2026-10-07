import type { ListPlacement } from '@spark-outpost/contracts';
import type { Session } from '../orchestration/session.ts';
import { placementFacts } from './assess.ts';
import { projectSettings, type ProjectSettings } from './builder-env.ts';
import type { CheckedPiece } from './pieces-validate.ts';
import { placePieces } from './placement.ts';
import { coordinatorMode } from './shadow.ts';

export interface ListPlace {
  placement: ListPlacement;
  reason: string;
}

const IN_ORDER_REASON = 'pieces run in order, one Builder at a time';

export function inOrderReason(s: Session, settings: ProjectSettings): string | null {
  if (coordinatorMode(s) !== 'parallel') return IN_ORDER_REASON;
  if (!settings.parallel) return 'parallel pieces are off for this project';
  if (settings.slots < 2) return 'this project runs one Builder at a time';
  if (s.needsCopy) return 'every piece runs in the task copy';
  return null;
}

export async function chooseListPlace(
  s: Session,
  pieces: readonly CheckedPiece[],
): Promise<ListPlace> {
  const settings = await projectSettings(s.deps.db, s.lease.runId);
  const inOrder = inOrderReason(s, settings);
  if (inOrder) return { placement: 'in_order', reason: inOrder };
  const placed = placePieces(pieces, placementFacts(s));
  return { placement: placed.placement, reason: placed.reason };
}
