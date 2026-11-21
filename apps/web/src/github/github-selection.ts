import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { defaultGroup } from './github-model.ts';

const OPEN_KEY = 'spark.github.openPull';
export const SIDE_BY_SIDE_WIDTH = 1080;

export type Remembered = { kind: 'open'; id: string } | { kind: 'closed' } | { kind: 'none' };

export function readRemembered(): Remembered {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    if (saved === null) return { kind: 'none' };
    return saved === '' ? { kind: 'closed' } : { kind: 'open', id: saved };
  } catch {
    return { kind: 'none' };
  }
}

export function rememberOpen(id: string | null): void {
  try {
    localStorage.setItem(OPEN_KEY, id ?? '');
  } catch {
    return;
  }
}

function newest(items: readonly GithubInboxItem[]): GithubInboxItem | undefined {
  return items.reduce<GithubInboxItem | undefined>(
    (best, item) => (!best || item.updatedAt > best.updatedAt ? item : best),
    undefined,
  );
}

export function initialPull(
  grouped: Record<GithubInboxGroup, GithubInboxItem[]>,
  remembered: Remembered,
): GithubInboxItem | null {
  if (remembered.kind === 'closed') return null;
  if (remembered.kind === 'open') {
    const found = Object.values(grouped)
      .flat()
      .find((item) => item.id === remembered.id);
    if (found) return found;
  }
  return newest(grouped[defaultGroup(grouped)]) ?? null;
}
