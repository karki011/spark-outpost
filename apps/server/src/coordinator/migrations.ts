import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { gitChanges } from '../projects/snapshot.ts';
import { inMigrationsFolder } from './placement.ts';

const NUMBERED = /^(\d+)([-_].+)$/;

export interface Rename {
  from: string;
  to: string;
}

interface Numbered {
  folder: string;
  number: bigint;
  width: number;
  rest: string;
}

function numbered(file: string): Numbered | null {
  if (!inMigrationsFolder(file)) return null;
  const match = NUMBERED.exec(path.posix.basename(file));
  if (!match) return null;
  return {
    folder: path.posix.dirname(file),
    number: BigInt(match[1]!),
    width: match[1]!.length,
    rest: match[2]!,
  };
}

export function renumberMigrations(
  added: readonly string[],
  existing: readonly string[],
): Rename[] {
  const taken = new Map<string, Set<bigint>>();
  const addedSet = new Set(added);
  const take = (folder: string, number: bigint) => {
    const numbers = taken.get(folder) ?? new Set<bigint>();
    numbers.add(number);
    taken.set(folder, numbers);
  };
  for (const file of existing) {
    const parsed = addedSet.has(file) ? null : numbered(file);
    if (parsed) take(parsed.folder, parsed.number);
  }
  const renames: Rename[] = [];
  for (const file of [...added].sort()) {
    const parsed = numbered(file);
    if (!parsed) continue;
    const numbers = taken.get(parsed.folder) ?? new Set<bigint>();
    if (!numbers.has(parsed.number)) {
      take(parsed.folder, parsed.number);
      continue;
    }
    const next = [...numbers].reduce((most, value) => (value > most ? value : most)) + 1n;
    take(parsed.folder, next);
    const name = `${next.toString().padStart(parsed.width, '0')}${parsed.rest}`;
    renames.push({ from: file, to: path.posix.join(parsed.folder, name) });
  }
  return renames;
}

export async function renumberCopy(
  copy: string,
  base: string,
  existing: readonly string[],
): Promise<Rename[]> {
  const added = (await gitChanges(copy, base))
    .filter((change) => change.change === 'added')
    .map((change) => change.path);
  const renames = renumberMigrations(added, existing);
  for (const { from, to } of renames) {
    await mkdir(path.dirname(path.join(copy, to)), { recursive: true });
    await rename(path.join(copy, from), path.join(copy, to));
  }
  return renames;
}
