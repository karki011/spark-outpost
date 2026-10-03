import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  isInstructionsFileName,
  isSecretFileName,
  type FolderFile,
  type FolderListing,
} from '@spark-outpost/contracts';

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

export interface FolderListOptions {
  instructionFiles?: boolean;
  hidden?: boolean;
}

const FILES_MAX = 500;

async function fileSize(target: string): Promise<number | null> {
  try {
    const stats = await stat(target);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

async function instructionFiles(real: string, names: readonly string[]): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  for (const name of names) {
    if (files.length >= FILES_MAX) break;
    if (isSecretFileName(name) || !isInstructionsFileName(name)) continue;
    const full = path.join(real, name);
    const sizeBytes = await fileSize(full);
    if (sizeBytes !== null) files.push({ name, path: full, sizeBytes });
  }
  return files;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export async function listFolders(
  requested?: string,
  options: FolderListOptions = {},
): Promise<FolderListing> {
  const real = await realDirectory(requested || homedir());
  let entries;
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch {
    throw new FolderError("Spark Outpost can't open that folder.");
  }
  const shown = entries.filter((entry) => options.hidden || !entry.name.startsWith('.'));
  const candidates = shown.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  const folders = [];
  for (const entry of candidates) {
    const full = path.join(real, entry.name);
    if (entry.isDirectory() || (await isDirectory(full)))
      folders.push({ name: entry.name, path: full });
  }
  folders.sort(byName);
  const files = options.instructionFiles
    ? await instructionFiles(
        real,
        shown
          .filter((entry) => entry.isFile() || entry.isSymbolicLink())
          .map((entry) => entry.name)
          .sort((a, b) => byName({ name: a }, { name: b })),
      )
    : [];
  const parent = path.dirname(real);
  return { path: real, parent: parent === real ? null : parent, folders, files };
}
