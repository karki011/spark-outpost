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

async function remoteRefs(root: string): Promise<string[]> {
  try {
    const output = await git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes']);
    return output.split('\n').filter((ref) => ref !== '' && !ref.endsWith('/HEAD'));
  } catch {
    return [];
  }
}

export async function publishedState(
  root: string,
  expected: ReadonlyMap<string, string | null>,
): Promise<PublishedState> {
  const committed = await holdsAll(root, 'HEAD', expected);
  if (!committed) return { committed, pushed: false };
  for (const ref of await remoteRefs(root)) {
    if (await holdsAll(root, ref, expected)) return { committed, pushed: true };
  }
  return { committed, pushed: false };
}
