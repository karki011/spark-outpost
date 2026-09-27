import { z } from 'zod';
import type { RunChange } from '@spark-outpost/contracts';
import { git } from '../projects/snapshot.ts';

export const KEPT_FILES_MAX = 200;
export const COMMIT_SCAN_MAX = 200;
const SINCE_SLACK_SECONDS = 60;

export const keptContentSchema = z.object({
  root: z.string(),
  branch: z.string(),
  at: z.string(),
  files: z.array(z.object({ path: z.string(), blob: z.string().nullable() })),
});
export type KeptContent = z.infer<typeof keptContentSchema>;

export interface FoundCommit {
  sha: string;
  at: Date;
}

async function currentBranch(root: string): Promise<string | null> {
  try {
    return (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

async function blobsOf(root: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const output = await git(root, ['hash-object', '--', ...paths]);
  return output.trim().split('\n');
}

export async function keptContent(
  root: string,
  changes: readonly RunChange[],
  at: Date,
): Promise<KeptContent | null> {
  if (changes.length === 0 || changes.length > KEPT_FILES_MAX) return null;
  const branch = await currentBranch(root);
  if (!branch) return null;
  const present = changes.filter((change) => change.change !== 'deleted').map((c) => c.path);
  const blobs = await blobsOf(root, present);
  const byPath = new Map(present.map((file, index) => [file, blobs[index] ?? null]));
  return {
    root,
    branch,
    at: at.toISOString(),
    files: changes.map((change) => ({ path: change.path, blob: byPath.get(change.path) ?? null })),
  };
}

export function parseLsTree(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of output.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [, type, sha] = entry.slice(0, tab).split(' ');
    if (type === 'blob' && sha) entries.set(entry.slice(tab + 1), sha);
  }
  return entries;
}

export function matchesKept(kept: KeptContent, tree: ReadonlyMap<string, string>): boolean {
  return kept.files.every((file) =>
    file.blob === null ? !tree.has(file.path) : tree.get(file.path) === file.blob,
  );
}

async function commitsSince(root: string, branch: string, since: Date): Promise<string[]> {
  const seconds = Math.floor(since.getTime() / 1000) - SINCE_SLACK_SECONDS;
  const output = await git(root, [
    'rev-list',
    `--max-count=${COMMIT_SCAN_MAX}`,
    `--since=${seconds}`,
    `refs/heads/${branch}`,
    '--',
  ]);
  return output.trim().split('\n').filter(Boolean).reverse();
}

async function treeAt(root: string, commit: string, paths: readonly string[]) {
  const literal = paths.map((file) => `:(literal)${file}`);
  return parseLsTree(await git(root, ['ls-tree', '-r', '-z', commit, '--', ...literal]));
}

async function committedAt(root: string, commit: string): Promise<Date> {
  return new Date((await git(root, ['show', '-s', '--format=%cI', commit])).trim());
}

export async function findKeptCommit(kept: KeptContent): Promise<FoundCommit | null> {
  const paths = kept.files.map((file) => file.path);
  const commits = await commitsSince(kept.root, kept.branch, new Date(kept.at));
  for (const commit of commits) {
    if (matchesKept(kept, await treeAt(kept.root, commit, paths))) {
      return { sha: commit, at: await committedAt(kept.root, commit) };
    }
  }
  return null;
}
