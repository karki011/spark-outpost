import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  isInstructionsFileName,
  isSecretFileName,
  type FolderEntry,
  type FolderFile,
  type FolderListing,
  type FolderListingEntry,
} from '@spark-outpost/contracts';

export class FolderError extends Error {}

const NO_ACCESS =
  'macOS didn’t let Spark Outpost open this folder. Allow it in System Settings → Privacy & Security (Files and Folders, or Full Disk Access), then open it again.';
const QUICK_PLACES = ['Desktop', 'Documents', 'Downloads'];
const VOLUMES = '/Volumes';

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
  home?: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function homeFolder(home: string | undefined): Promise<string> {
  const chosen = home ?? homedir();
  return realpath(chosen).catch(() => chosen);
}

async function volumes(): Promise<FolderEntry[]> {
  const entries = await readdir(VOLUMES).catch(() => []);
  const found: FolderEntry[] = [];
  for (const name of entries.toSorted()) {
    const full = path.join(VOLUMES, name);
    const real = await realpath(full).catch(() => null);
    if (real && real !== '/' && (await isDirectory(real))) found.push({ name, path: full });
  }
  return found;
}

async function quickPlaces(home: string): Promise<FolderEntry[]> {
  const places: FolderEntry[] = [{ name: 'Home', path: home }];
  for (const name of QUICK_PLACES) {
    const full = path.join(home, name);
    if (await isDirectory(full)) places.push({ name, path: full });
  }
  return [...places, ...(await volumes())];
}

function parentOf(real: string): string | null {
  const parent = path.dirname(real);
  return parent === real ? null : parent;
}

function deniedListing(real: string, places: FolderEntry[]): FolderListing {
  return { path: real, parent: parentOf(real), folders: [], files: [], places, denied: NO_ACCESS };
}

async function startFolder(home: string): Promise<string> {
  const documents = path.join(home, 'Documents');
  return (await isDirectory(documents)) ? documents : home;
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
  const home = await homeFolder(options.home);
  const real = await realDirectory(requested || (await startFolder(home)));
  const places = await quickPlaces(home);
  let entries;
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EPERM' || code === 'EACCES') return deniedListing(real, places);
    throw new FolderError("Spark Outpost can't open that folder.");
  }
  const shown = entries.filter((entry) => options.hidden || !entry.name.startsWith('.'));
  const candidates = shown.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  const folders: FolderListingEntry[] = [];
  for (const entry of candidates) {
    const full = path.join(real, entry.name);
    if (entry.isDirectory() || (await isDirectory(full))) {
      folders.push({
        name: entry.name,
        path: full,
        repository: await exists(path.join(full, '.git')),
      });
    }
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
  return { path: real, parent: parentOf(real), folders, files, places, denied: null };
}

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function createFolder(parent: string, name: string, home: string): Promise<string> {
  const real = await realDirectory(parent);
  if (!isInside(real, home)) throw new FolderError('Make new folders inside your home folder.');
  const target = path.join(real, name);
  if (path.dirname(target) !== real || path.basename(target) !== name) {
    throw new FolderError('Use a folder name, not a path.');
  }
  try {
    await mkdir(target);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new FolderError(`“${name}” is already there.`);
    throw new FolderError("Spark Outpost can't make a folder there.");
  }
  return target;
}
