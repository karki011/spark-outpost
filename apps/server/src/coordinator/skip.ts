import type { PieceStatus, TaskPiece } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { movePiece } from '../persistence/pieces.ts';
import { reaches } from './graph.ts';

export const SKIPPED_BY_USER = 'You skipped it.';

const OPEN: readonly PieceStatus[] = ['pending', 'ready', 'running'];

export function dependentsOf(pieces: readonly TaskPiece[], key: string): TaskPiece[] {
  const graph = new Map(pieces.map((piece) => [piece.key, piece.dependsOn]));
  return pieces.filter((piece) => piece.key !== key && reaches(graph, piece.key, key));
}

export function skipBlocker(piece: TaskPiece): string | null {
  if (piece.status === 'landed') return `${piece.key} has landed; ask for a change instead.`;
  if (piece.status === 'skipped') return `${piece.key} is already skipped.`;
  if (piece.status === 'failed') return `${piece.key} has already stopped.`;
  return null;
}

export async function skipDependents(
  db: Queryable,
  pieces: readonly TaskPiece[],
  key: string,
): Promise<string[]> {
  const skipped: string[] = [];
  for (const dependent of dependentsOf(pieces, key)) {
    const note = `skipped: depends on ${key}`;
    if (await movePiece(db, dependent.id, ['pending', 'ready'], 'skipped', { note })) {
      skipped.push(dependent.key);
    }
  }
  return skipped;
}

export async function skipWithDependents(
  db: Queryable,
  pieces: readonly TaskPiece[],
  piece: TaskPiece,
): Promise<string[]> {
  const moved = await movePiece(db, piece.id, OPEN, 'skipped', { note: SKIPPED_BY_USER });
  const dependents = await skipDependents(db, pieces, piece.key);
  return moved ? [piece.key, ...dependents] : dependents;
}
