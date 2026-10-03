import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PieceViolation, TaskPiece } from '@spark-outpost/contracts';
import { gitFileAt } from '../projects/snapshot.ts';
import { ownerLabel, owns, type OwnedFiles, type OwnedSet } from './owned.ts';
import { sharedTreeBlocker } from './placement.ts';
import type { Coordination } from './state.ts';

export function ownedFilesFor(coordination: Coordination, piece: TaskPiece): OwnedFiles {
  const setOf = (key: string): OwnedSet => coordination.owned.get(key) ?? { paths: [], globs: [] };
  return {
    key: piece.key,
    name: coordination.names.get(piece.key) ?? null,
    ...setOf(piece.key),
    others: (coordination.list?.pieces ?? [])
      .filter((other) => other.key !== piece.key && !other.research)
      .map((other) => ({
        key: other.key,
        name: coordination.names.get(other.key) ?? null,
        ...setOf(other.key),
      })),
  };
}

export async function revertFile(cwd: string, before: string, relative: string): Promise<void> {
  const content = await gitFileAt(cwd, before, `./${relative}`);
  const target = path.join(cwd, relative);
  if (content === null) await rm(target, { force: true });
  else await writeFile(target, content);
}

function adopt(coordination: Coordination, key: string, files: readonly string[]): void {
  const current = coordination.owned.get(key) ?? { paths: [], globs: [] };
  const owned = new Map(coordination.owned);
  owned.set(key, { paths: [...current.paths, ...files], globs: current.globs });
  coordination.owned = owned;
}

export async function checkOwnership(
  coordination: Coordination,
  piece: TaskPiece,
  changed: readonly string[],
  cwd: string,
  before: string,
): Promise<PieceViolation[]> {
  const owned = ownedFilesFor(coordination, piece);
  const outside = changed.filter((file) => !owns(owned, file));
  const violations: PieceViolation[] = [];
  const unowned: string[] = [];
  for (const file of outside) {
    const owner = owned.others.find((other) => owns(other, file));
    if (!owner) {
      unowned.push(file);
      continue;
    }
    await revertFile(cwd, before, file);
    violations.push({ path: file, action: 'reverted', owner: ownerLabel(owner) });
  }
  const kept = unowned.filter((file) => sharedTreeBlocker(file) === null);
  for (const file of unowned) {
    const moved = kept.includes(file);
    if (!moved) await revertFile(cwd, before, file);
    violations.push({ path: file, action: moved ? 'moved' : 'reverted', owner: null });
  }
  if (kept.length > 0) adopt(coordination, piece.key, kept);
  if (violations.length > 0) coordination.violations += 1;
  return violations;
}

export function violationNote(violations: readonly PieceViolation[]): string | null {
  if (violations.length === 0) return null;
  const lines = violations.map((violation) => {
    const whose = violation.owner ? `${violation.owner} owns it` : 'no piece owned it';
    return violation.action === 'moved'
      ? `- \`${violation.path}\`: ${whose}; it is now part of your piece.`
      : `- \`${violation.path}\`: ${whose}; your change was reverted.`;
  });
  return `## Note from the coordinator\nYou changed files outside your piece:\n${lines.join('\n')}`;
}
