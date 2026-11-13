import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CREW_FILES_MAX,
  CREW_FILE_MAX_BYTES,
  CREW_PATH_DEPTH_MAX,
  SPARK_INSTRUCTIONS_FILE,
  crewPathProblem,
  type CrewFile,
  type CrewFileEntry,
  type SaveCrewFile,
} from '@spark-outpost/contracts';
import { sparkFolderPath } from './folders.ts';

export class CrewFileNotFoundError extends Error {
  constructor() {
    super('That file was not found.');
  }
}

export class CrewFileConflictError extends Error {}

export class CrewFileProblemError extends Error {}

const MAX_KB = Math.round(CREW_FILE_MAX_BYTES / 1024);

export const CREW_PROBLEMS = {
  link: 'Links inside a Spark folder are not followed.',
  notFile: 'That path is a folder, not a file.',
  large: `A file in a Spark folder can be at most ${MAX_KB} KB.`,
  binary: 'This file is not plain text.',
  full: `A Spark folder can hold up to ${CREW_FILES_MAX} files.`,
  exists: 'A file with this name already exists.',
  changed: 'This file changed since you opened it. Reload it and make the change again.',
  blocked: 'A file is in the way of that folder name.',
} as const;

export function crewFileHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function codeOf(error: unknown): string {
  return (error as NodeJS.ErrnoException | null)?.code ?? '';
}

const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

async function kindOf(target: string): Promise<'file' | 'folder' | 'link' | 'other' | null> {
  try {
    const found = await lstat(target);
    if (found.isSymbolicLink()) return 'link';
    if (found.isDirectory()) return 'folder';
    return found.isFile() ? 'file' : 'other';
  } catch (error) {
    if (ABSENT.has(codeOf(error))) return null;
    throw error;
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertNoEscape(folder: string, target: string): Promise<void> {
  const [realFolder, realTarget] = await Promise.all([realpath(folder), realpath(target)]);
  if (!inside(realFolder, realTarget)) throw new CrewFileProblemError(CREW_PROBLEMS.link);
}

async function placed(folder: string, relative: string): Promise<string> {
  const problem = crewPathProblem(relative);
  if (problem) throw new CrewFileProblemError(problem);
  if ((await kindOf(folder)) === 'link') throw new CrewFileProblemError(CREW_PROBLEMS.link);
  const segments = relative.split('/');
  let current = folder;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const kind = await kindOf(current);
    if (kind === null) break;
    if (kind === 'link' || kind === 'other') throw new CrewFileProblemError(CREW_PROBLEMS.link);
    if (kind === 'file' && index < segments.length - 1) {
      throw new CrewFileProblemError(CREW_PROBLEMS.blocked);
    }
  }
  return path.join(folder, ...segments);
}

function decoded(bytes: Buffer): string {
  if (bytes.includes(0)) throw new CrewFileProblemError(CREW_PROBLEMS.binary);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new CrewFileProblemError(CREW_PROBLEMS.binary);
  }
}

async function readText(folder: string, target: string): Promise<string | null> {
  const kind = await kindOf(target);
  if (kind === null) return null;
  if (kind !== 'file') throw new CrewFileProblemError(CREW_PROBLEMS.notFile);
  await assertNoEscape(folder, target);
  const handle = await open(target, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new CrewFileProblemError(CREW_PROBLEMS.notFile);
    if (stats.size > CREW_FILE_MAX_BYTES) throw new CrewFileProblemError(CREW_PROBLEMS.large);
    return decoded(await handle.readFile());
  } finally {
    await handle.close();
  }
}

interface Walked {
  files: CrewFileEntry[];
  truncated: boolean;
}

async function walk(folder: string): Promise<Walked> {
  const files: CrewFileEntry[] = [];
  let truncated = false;
  const visit = async (dir: string, prefix: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (crewPathProblem(relative) !== null) continue;
      if (entry.isDirectory() && depth < CREW_PATH_DEPTH_MAX) {
        await visit(path.join(dir, entry.name), relative, depth + 1);
      } else if (entry.isFile()) {
        if (files.length >= CREW_FILES_MAX) {
          truncated = true;
          return;
        }
        const stats = await lstat(path.join(dir, entry.name)).catch(() => null);
        if (stats?.isFile()) files.push({ path: relative, bytes: stats.size });
      }
    }
  };
  if ((await kindOf(folder)) === 'folder') await visit(folder, '', 1);
  return { files, truncated };
}

export async function crewFileEntries(sparksDir: string, sparkId: string): Promise<Walked> {
  return walk(sparkFolderPath(sparksDir, sparkId));
}

export async function readCrewFile(
  sparksDir: string,
  sparkId: string,
  relative: string,
): Promise<CrewFile> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  const text = await readText(folder, await placed(folder, relative));
  if (text === null) throw new CrewFileNotFoundError();
  return { path: relative, text, hash: crewFileHash(text) };
}

const LONE_SURROGATE = /\p{Surrogate}/u;

export function crewTextProblem(text: string): string | null {
  if (text.includes('\0') || LONE_SURROGATE.test(text)) return CREW_PROBLEMS.binary;
  if (Buffer.byteLength(text, 'utf8') > CREW_FILE_MAX_BYTES) return CREW_PROBLEMS.large;
  return null;
}

function assertStorable(text: string): void {
  const problem = crewTextProblem(text);
  if (problem) throw new CrewFileProblemError(problem);
}

async function writeAtomically(target: string, text: string): Promise<void> {
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    if (codeOf(error) === 'EISDIR' || codeOf(error) === 'ENOTDIR') {
      throw new CrewFileProblemError(CREW_PROBLEMS.notFile);
    }
    throw error;
  }
}

let writing: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writing.then(work);
  writing = next.catch(() => undefined);
  return next;
}

function assertBase(current: string | null, baseHash: string | null): void {
  if (baseHash === null) {
    if (current !== null) throw new CrewFileConflictError(CREW_PROBLEMS.exists);
    return;
  }
  if (current === null || crewFileHash(current) !== baseHash) {
    throw new CrewFileConflictError(CREW_PROBLEMS.changed);
  }
}

async function put(folder: string, relative: string, text: string, baseHash?: string | null) {
  assertStorable(text);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = await placed(folder, relative);
  const kind = await kindOf(target);
  if (kind === 'folder') throw new CrewFileProblemError(CREW_PROBLEMS.notFile);
  if (baseHash !== undefined) assertBase(await readText(folder, target), baseHash);
  if (kind === null) {
    const { files } = await walk(folder);
    if (files.length >= CREW_FILES_MAX) throw new CrewFileProblemError(CREW_PROBLEMS.full);
  }
  await writeAtomically(target, text);
  await assertNoEscape(folder, target);
}

export function saveCrewFile(
  sparksDir: string,
  sparkId: string,
  input: SaveCrewFile,
): Promise<CrewFile> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  return serialized(async () => {
    await put(folder, input.path, input.text, input.baseHash);
    return { path: input.path, text: input.text, hash: crewFileHash(input.text) };
  });
}

async function pruneEmptyParents(folder: string, target: string): Promise<void> {
  let dir = path.dirname(target);
  while (inside(folder, dir)) {
    const removed = await rmdir(dir).then(
      () => true,
      () => false,
    );
    if (!removed) return;
    dir = path.dirname(dir);
  }
}

async function remove(folder: string, relative: string): Promise<boolean> {
  const target = await placed(folder, relative);
  const kind = await kindOf(target);
  if (kind === null) return false;
  if (kind !== 'file') throw new CrewFileProblemError(CREW_PROBLEMS.notFile);
  await assertNoEscape(folder, target);
  await rm(target);
  await pruneEmptyParents(folder, target);
  return true;
}

export function deleteCrewFile(sparksDir: string, sparkId: string, relative: string) {
  const folder = sparkFolderPath(sparksDir, sparkId);
  return serialized(async () => {
    if (!(await remove(folder, relative))) throw new CrewFileNotFoundError();
  });
}

export function removeSparkFolder(sparksDir: string, sparkId: string): Promise<void> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  return serialized(() => rm(folder, { recursive: true, force: true }));
}

export async function readSparkInstructions(sparksDir: string, sparkId: string): Promise<string> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  try {
    return (await readText(folder, await placed(folder, SPARK_INSTRUCTIONS_FILE))) ?? '';
  } catch (error) {
    if (error instanceof CrewFileProblemError) return '';
    throw error;
  }
}

export function writeSparkInstructions(
  sparksDir: string,
  sparkId: string,
  text: string,
): Promise<void> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  return serialized(async () => {
    if (text === '') {
      await remove(folder, SPARK_INSTRUCTIONS_FILE);
      return;
    }
    await put(folder, SPARK_INSTRUCTIONS_FILE, text);
  });
}

export async function hasSparkInstructions(sparksDir: string, sparkId: string): Promise<boolean> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  return (await kindOf(path.join(folder, SPARK_INSTRUCTIONS_FILE))) !== null;
}
