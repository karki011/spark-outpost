import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FolderListing } from '@spark-outpost/contracts';

export class FolderError extends Error {}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export async function realDirectory(requested: string): Promise<string> {
  if (!path.isAbsolute(requested)) throw new FolderError('Choose a folder by its full path.');
  let real: string;
  try {
    real = await realpath(requested);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new FolderError("That folder doesn't exist.");
    throw new FolderError("Spark Outpost can't open that folder.");
  }
  if (!(await stat(real)).isDirectory()) throw new FolderError('That path is not a folder.');
  return real;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function listFolders(requested?: string): Promise<FolderListing> {
  const real = await realDirectory(requested || homedir());
  let entries;
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch {
    throw new FolderError("Spark Outpost can't open that folder.");
  }
  const candidates = entries.filter(
    (entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()),
  );
  const folders = [];
  for (const entry of candidates) {
    const full = path.join(real, entry.name);
    if (entry.isDirectory() || (await isDirectory(full)))
      folders.push({ name: entry.name, path: full });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(real);
  return { path: real, parent: parent === real ? null : parent, folders };
}
