import type { ListPlacement, PiecePlacement } from '@spark-outpost/contracts';

const MIGRATIONS = /(?:^|\/)(?:migrations?|migrate|db\/migrate)\//i;

export const NOT_GIT_REASON = 'the project is not a git repository';
export const SHARED_TREE_REASON = 'the plan gives each piece its own files in one working tree';

export function inMigrationsFolder(file: string): boolean {
  return MIGRATIONS.test(file);
}

export interface PlaceablePiece {
  key: string;
  research: boolean;
}

export interface PlacementFacts {
  git: boolean;
}

export interface Placement {
  placement: ListPlacement;
  reason: string;
  pieces: { key: string; placement: PiecePlacement }[];
}

function listPlace(facts: PlacementFacts): Pick<Placement, 'placement' | 'reason'> {
  if (!facts.git) return { placement: 'in_order', reason: NOT_GIT_REASON };
  return { placement: 'shared', reason: SHARED_TREE_REASON };
}

export function placePieces(pieces: readonly PlaceablePiece[], facts: PlacementFacts): Placement {
  const chosen = listPlace(facts);
  return {
    ...chosen,
    pieces: pieces.map((piece) => ({
      key: piece.key,
      placement: piece.research ? 'read_only' : chosen.placement,
    })),
  };
}
