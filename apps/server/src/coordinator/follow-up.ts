import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { addRequirement, insertPieceNote } from '../persistence/piece-notes.ts';
import { isGlob, owns, type OwnedSet } from './owned.ts';

export interface Requirement {
  body: string;
  files: readonly string[];
  source: 'user' | 'coordinator';
  from?: string;
}

export type RequirementRoute =
  { to: 'worker'; key: string; running: boolean } | { to: 'follow_up' };

const OPEN_FIRST: readonly TaskPiece['status'][] = ['running', 'ready', 'pending'];

function ownedSet(piece: TaskPiece): OwnedSet {
  return {
    paths: piece.owns.filter((path) => !isGlob(path)),
    globs: piece.owns.filter(isGlob),
  };
}

export function requirementTarget(
  pieces: readonly TaskPiece[],
  requirement: Pick<Requirement, 'files' | 'from'>,
): TaskPiece | null {
  for (const status of OPEN_FIRST) {
    const found = pieces.find(
      (piece) =>
        piece.status === status &&
        !piece.research &&
        piece.key !== requirement.from &&
        requirement.files.some((file) => owns(ownedSet(piece), file)),
    );
    if (found) return found;
  }
  return null;
}

export async function routeRequirement(
  db: Queryable,
  list: PieceList,
  requirement: Requirement,
): Promise<RequirementRoute> {
  const note = {
    kind: 'requirement_added' as const,
    body: requirement.body,
    source: requirement.source,
    urgent: false,
  };
  const target = requirementTarget(list.pieces, requirement);
  if (!target) {
    await insertPieceNote(db, { listId: list.id }, note);
    return { to: 'follow_up' };
  }
  await addRequirement(db, target.id, requirement.body);
  await insertPieceNote(db, { pieceId: target.id }, note);
  return { to: 'worker', key: target.key, running: target.status === 'running' };
}
