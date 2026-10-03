import { randomUUID } from 'node:crypto';
import { copyFile, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

export const SNAPSHOT_INDEX_NAME = 'spark-outpost-snapshot-index';

type RunGit = (root: string, args: string[]) => Promise<string>;

const locations = new Map<string, Promise<string | null>>();

async function locate(root: string, git: RunGit): Promise<string | null> {
  try {
    const relative = (await git(root, ['rev-parse', '--git-path', SNAPSHOT_INDEX_NAME])).trim();
    return relative ? path.resolve(root, relative) : null;
  } catch {
    return null;
  }
}

export function snapshotIndexPath(root: string, git: RunGit): Promise<string | null> {
  let found = locations.get(root);
  if (!found) {
    found = locate(root, git);
    locations.set(root, found);
    void found.then((location) => {
      if (location === null) locations.delete(root);
    });
  }
  return found;
}

export function racySafeSecond(now: number = Date.now()): number {
  return Math.floor(now / 1000) - 1;
}

export async function seedSnapshotIndex(saved: string, scratch: string): Promise<boolean> {
  try {
    const stats = await stat(saved);
    await copyFile(saved, scratch);
    const second = Math.floor(stats.mtimeMs / 1000);
    await utimes(scratch, second, second);
    return true;
  } catch {
    await rm(scratch, { force: true });
    return false;
  }
}

export async function saveSnapshotIndex(
  scratch: string,
  saved: string,
  startedSecond: number,
): Promise<void> {
  const staged = `${saved}.${randomUUID()}`;
  try {
    await copyFile(scratch, staged);
    await utimes(staged, startedSecond, startedSecond);
    await rename(staged, saved);
  } catch {
    await rm(staged, { force: true });
  }
}
