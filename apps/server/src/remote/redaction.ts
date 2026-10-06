import type { Response } from 'express';
import type { SetupState } from '@spark-outpost/contracts';
import { isRemote } from './principal.ts';

const MASK = '…';

export function isGitInternalPath(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment.toLowerCase() === '.git');
}

function lastFour(detail: string | null): string | null {
  if (!detail?.includes(MASK)) return detail;
  return `${MASK}${detail.slice(detail.lastIndexOf(MASK) + MASK.length)}`;
}

function withShortKey<T extends { connection: { detail: string | null } | null }>(entry: T): T {
  if (!entry.connection) return entry;
  return {
    ...entry,
    connection: { ...entry.connection, detail: lastFour(entry.connection.detail) },
  };
}

export function setupStateFor(res: Response, state: SetupState): SetupState {
  if (!isRemote(res)) return state;
  return {
    ...state,
    providers: state.providers.map(withShortKey),
    advisors: state.advisors.map(withShortKey),
  };
}
