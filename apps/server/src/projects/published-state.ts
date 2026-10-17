import { blobAt, git } from './snapshot.ts';

export interface PublishedState {
  committed: boolean;
  pushed: boolean;
}

async function holdsAll(
  root: string,
  ref: string,
  expected: ReadonlyMap<string, string | null>,
): Promise<boolean> {
  for (const [relative, blob] of expected) {
    if ((await blobAt(root, ref, relative)) !== blob) return false;
  }
  return true;
}

async function quietly(root: string, args: string[]): Promise<string> {
  try {
    return (await git(root, args)).trim();
  } catch {
    return '';
  }
}

async function onRemote(root: string, start: string | null, paths: readonly string[]) {
  const since = start ? [`^${start}`] : [];
  const literal = paths.map((relative) => `:(literal)${relative}`);
  const commit = await quietly(root, [
    'log',
    '-1',
    '--format=%H',
    'HEAD',
    ...since,
    '--',
    ...literal,
  ]);
  if (!commit) return false;
  const holders = await quietly(root, [
    'branch',
    '-r',
    '--format=%(refname)',
    '--contains',
    commit,
  ]);
  return holders.split('\n').some((ref) => ref !== '' && !ref.endsWith('/HEAD'));
}

export async function publishedState(
  root: string,
  snapshotRef: string,
  expected: ReadonlyMap<string, string | null>,
): Promise<PublishedState> {
  const committed = await holdsAll(root, 'HEAD', expected);
  if (!committed) return { committed, pushed: false };
  const start = (await quietly(root, ['rev-parse', '--verify', '-q', `${snapshotRef}^1`])) || null;
  return { committed, pushed: await onRemote(root, start, [...expected.keys()]) };
}
