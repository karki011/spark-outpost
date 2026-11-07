import { lstat, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { cloneNameProblem } from '@spark-outpost/contracts';
import type { DirectoryIdentity } from '../../persistence/project-clones.ts';
import { realDirectory } from '../folders.ts';

export class CloneRefusedError extends Error {}

export interface DestinationRules {
  home: string;
  projectRoots: readonly string[];
  reserved: readonly string[];
}

export interface Destination {
  path: string;
  state: 'missing' | 'empty' | 'occupied';
}

export type RemovedClaim = 'removed' | 'missing' | 'changed';

const SPARK_FOLDER = '.spark';
const SPARK_OWNED = 'Spark keeps its own files there. Choose another folder.';

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function stateOf(target: string): Promise<Destination['state']> {
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'missing';
    throw new CloneRefusedError("Spark can't open that folder.");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) return 'occupied';
  return (await readdir(target)).length === 0 ? 'empty' : 'occupied';
}

export async function resolveDestination(
  parentPath: string,
  rawName: string,
  rules: DestinationRules,
): Promise<Destination> {
  const name = rawName.trim();
  const problem = cloneNameProblem(name);
  if (problem) throw new CloneRefusedError(problem);
  const parent = await realDirectory(parentPath);
  if (!isWithin(parent, rules.home)) {
    throw new CloneRefusedError('Choose a folder inside your home folder.');
  }
  const target = path.join(parent, name);
  if (target.split(path.sep).includes(SPARK_FOLDER)) {
    throw new CloneRefusedError(SPARK_OWNED);
  }
  if (rules.reserved.some((root) => isWithin(target, root))) {
    throw new CloneRefusedError(SPARK_OWNED);
  }
  const project = rules.projectRoots.find((root) => isWithin(target, root));
  if (project) {
    throw new CloneRefusedError(
      `That folder is inside the project at ${project}. Choose a folder outside it.`,
    );
  }
  return { path: target, state: await stateOf(target) };
}

export async function destinationAt(target: string): Promise<Destination> {
  return { path: target, state: await stateOf(target) };
}

function occupied(target: string): CloneRefusedError {
  return new CloneRefusedError(
    `${target} already exists and is not empty. Choose another name or folder.`,
  );
}

async function identityOf(target: string): Promise<DirectoryIdentity | 'missing' | 'other'> {
  try {
    const stats = await lstat(target, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) return 'other';
    return { dev: stats.dev.toString(), ino: stats.ino.toString() };
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? 'missing' : 'other';
  }
}

export async function claimDestination(destination: Destination): Promise<DirectoryIdentity> {
  if (destination.state === 'occupied') throw occupied(destination.path);
  try {
    if (destination.state === 'empty') await rmdir(destination.path);
    await mkdir(destination.path);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR') {
      throw occupied(destination.path);
    }
    throw new CloneRefusedError(
      `Spark can't create ${destination.path}. Check the folder's permissions.`,
    );
  }
  const identity = await identityOf(destination.path);
  if (typeof identity === 'string') {
    throw new CloneRefusedError(`Spark can't create ${destination.path}.`);
  }
  return identity;
}

export async function removeClaimed(
  target: string,
  claimed: DirectoryIdentity,
): Promise<RemovedClaim> {
  const found = await identityOf(target);
  if (found === 'missing') return 'missing';
  if (found === 'other' || found.dev !== claimed.dev || found.ino !== claimed.ino) return 'changed';
  await rm(target, { recursive: true, force: true });
  return 'removed';
}
