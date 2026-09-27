import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { workingChanges } from './git.ts';

export const STATUS_TTL_MS = 5000;

export interface StatusEntry {
  at: number;
  indexMtime: number | null;
  changes: Promise<string[]>;
}

const entries = new Map<string, StatusEntry>();

export function statusIsFresh(
  entry: StatusEntry | undefined,
  now: number,
  indexMtime: number | null,
): entry is StatusEntry {
  return entry !== undefined && now - entry.at < STATUS_TTL_MS && entry.indexMtime === indexMtime;
}

async function gitIndexMtime(root: string): Promise<number | null> {
  try {
    return (await stat(join(root, '.git', 'index'))).mtimeMs;
  } catch {
    return null;
  }
}

export async function recentWorkingChanges(root: string): Promise<string[]> {
  const indexMtime = await gitIndexMtime(root);
  const now = Date.now();
  const entry = entries.get(root);
  if (statusIsFresh(entry, now, indexMtime)) return entry.changes;
  const changes = workingChanges(root);
  entries.set(root, { at: now, indexMtime, changes });
  return changes;
}
