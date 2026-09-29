import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHECKPOINT_OPTION, type PieceViolation, type TaskPiece } from '@spark-outpost/contracts';
import { gitFileAt } from '../projects/snapshot.ts';
import { askCard, CheckpointTimeout, ownershipCard } from '../orchestration/checkpoint.ts';
import type { Session } from '../orchestration/session.ts';
import { ownerLabel, owns, type OwnedFiles, type OwnedSet } from './owned.ts';
import { sharedTreeBlocker } from './placement.ts';
import type { Coordination } from './state.ts';

export type OwnershipOutcome = 'kept' | 'stopped';

export interface OwnershipResult {
  outcome: OwnershipOutcome;
  violations: PieceViolation[];
}

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

async function askAboutUnowned(
  s: Session,
  name: string,
  files: readonly string[],
): Promise<'keep' | 'revert' | 'stop'> {
  const answer = await askCard(s, ownershipCard(name, files));
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped' || answer.optionId === CHECKPOINT_OPTION.stop) return 'stop';
  return answer.optionId === CHECKPOINT_OPTION.keepInPiece ? 'keep' : 'revert';
}

async function settleUnowned(
  s: Session,
  owned: OwnedFiles,
  files: readonly string[],
): Promise<{ kept: string[]; stop: boolean }> {
  if (files.length === 0) return { kept: [], stop: false };
  if (s.input.level === 'balanced') {
    const choice = await askAboutUnowned(s, owned.name ?? owned.key, files);
    return { kept: choice === 'keep' ? [...files] : [], stop: choice === 'stop' };
  }
  return { kept: files.filter((file) => sharedTreeBlocker(file) === null), stop: false };
}

export async function checkOwnership(
  s: Session,
  coordination: Coordination,
  piece: TaskPiece,
  changed: readonly string[],
  cwd: string,
  before: string,
): Promise<OwnershipResult> {
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
  const settled = await settleUnowned(s, owned, unowned);
  for (const file of unowned) {
    const kept = settled.kept.includes(file);
    if (!kept && !settled.stop) await revertFile(cwd, before, file);
    violations.push({ path: file, action: kept ? 'moved' : 'reverted', owner: null });
  }
  if (settled.kept.length > 0) adopt(coordination, piece.key, settled.kept);
  if (violations.length > 0) coordination.violations += 1;
  return { outcome: settled.stop ? 'stopped' : 'kept', violations };
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
