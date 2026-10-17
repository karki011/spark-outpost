import { git } from './snapshot.ts';

export interface PublishedState {
  committed: boolean;
  pushed: boolean;
}

async function startOf(root: string, snapshotRef: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--verify', '-q', `${snapshotRef}^1`])).trim() || null;
  } catch {
    return null;
  }
}

async function touchedIn(
  root: string,
  revisions: readonly string[],
  paths: readonly string[],
): Promise<boolean> {
  try {
    const literal = paths.map((relative) => `:(literal)${relative}`);
    const found = await git(root, ['log', '-1', '--format=%H', ...revisions, '--', ...literal]);
    return found.trim() !== '';
  } catch {
    return false;
  }
}

export async function publishedState(
  root: string,
  snapshotRef: string,
  paths: readonly string[],
): Promise<PublishedState> {
  const start = await startOf(root, snapshotRef);
  const since = start ? [`^${start}`] : [];
  const committed = await touchedIn(root, ['HEAD', ...since], paths);
  const pushed = committed && (await touchedIn(root, ['--remotes', ...since], paths));
  return { committed, pushed };
}
