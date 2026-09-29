import { matchesGlob } from 'node:path';
import { z } from 'zod';

const GLOB = /[*?[{]/;

export interface OwnedSet {
  paths: readonly string[];
  globs: readonly string[];
}

export interface PieceOwner extends OwnedSet {
  key: string;
  name: string | null;
}

export interface OwnedFiles extends PieceOwner {
  others: readonly PieceOwner[];
}

const ownerSchema = z.object({
  key: z.string(),
  name: z.string().nullable(),
  paths: z.array(z.string()),
  globs: z.array(z.string()),
});

export const ownedFilesSchema = ownerSchema.extend({ others: z.array(ownerSchema) });

export function isGlob(pattern: string): boolean {
  return GLOB.test(pattern);
}

export function normalizeOwned(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.startsWith('/') || /^[A-Za-z]:\//.test(trimmed)) return null;
  if (trimmed.split('/').some((part) => part === '..' || part === '.')) return null;
  return trimmed;
}

export function owns(set: OwnedSet, relative: string): boolean {
  if (set.paths.includes(relative)) return true;
  return set.globs.some((glob) => matchesGlob(relative, glob));
}

export function ownerOf(files: OwnedFiles, relative: string): PieceOwner | null {
  if (owns(files, relative)) return files;
  return files.others.find((other) => owns(other, relative)) ?? null;
}

function literalPrefix(glob: string): string {
  const index = glob.search(GLOB);
  return index === -1 ? glob : glob.slice(0, index);
}

function globsMeet(a: string, b: string): boolean {
  const left = literalPrefix(a);
  const right = literalPrefix(b);
  return left.startsWith(right) || right.startsWith(left);
}

export function sharedFiles(a: OwnedSet, b: OwnedSet): string[] {
  const shared = new Set<string>();
  for (const path of a.paths) if (owns(b, path)) shared.add(path);
  for (const path of b.paths) if (owns(a, path)) shared.add(path);
  for (const left of a.globs) {
    for (const right of b.globs) if (globsMeet(left, right)) shared.add(`${left} ~ ${right}`);
  }
  return [...shared];
}

export function ownerLabel(owner: PieceOwner): string {
  return owner.name ? `${owner.name} (${owner.key})` : owner.key;
}
