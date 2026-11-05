import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git, headCommit } from './snapshot.ts';

const run = promisify(execFile);

async function maybe(root: string, args: string[]): Promise<string | null> {
  try {
    return (await git(root, args)).trim() || null;
  } catch {
    return null;
  }
}

function lines(output: string | null): string[] {
  return (output ?? '').split('\n').filter((line) => line !== '');
}

async function sharedRefExclusions(root: string, stacked: readonly string[]): Promise<string[]> {
  const branch = await maybe(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const own = branch ? [branch, ...stacked] : [...stacked];
  return [
    ...own.map((name) => `--exclude=*/${name}`),
    '--remotes',
    ...own.map((name) => `--exclude=${name}`),
    '--branches',
    '--tags',
  ];
}

async function newestImportedCommit(
  root: string,
  start: string,
  head: string,
  stacked: readonly string[],
): Promise<string | null> {
  const arrived = lines(await maybe(root, ['rev-list', '--topo-order', head, '--not', start]));
  if (arrived.length === 0) return null;
  const shared = await sharedRefExclusions(root, stacked);
  const own = new Set(lines(await maybe(root, ['rev-list', head, '--not', start, ...shared])));
  return arrived.find((commit) => !own.has(commit)) ?? null;
}

async function treeOf(root: string, commit: string): Promise<string | null> {
  return maybe(root, ['rev-parse', '--verify', '-q', `${commit}^{tree}`]);
}

async function startWorkOnto(
  root: string,
  start: string,
  snapshot: string,
  imported: string,
): Promise<string> {
  if ((await treeOf(root, start)) === (await treeOf(root, snapshot))) return imported;
  try {
    const { stdout } = await run(
      'git',
      [
        '-C',
        root,
        'merge-tree',
        '--write-tree',
        '--no-messages',
        `--merge-base=${start}`,
        imported,
        snapshot,
      ],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    return stdout.split('\n')[0]!.trim() || imported;
  } catch {
    return imported;
  }
}

async function runBase(
  root: string,
  snapshot: string,
  head: string | null,
  stacked: readonly string[],
): Promise<string> {
  if (!head) return snapshot;
  const start = await maybe(root, ['rev-parse', '--verify', '-q', `${snapshot}^1`]);
  if (!start || start === head) return snapshot;
  const imported = await newestImportedCommit(root, start, head, stacked);
  if (!imported) return snapshot;
  return startWorkOnto(root, start, snapshot, imported);
}

export async function liveRunBase(
  root: string,
  snapshot: string,
  stacked: readonly string[] = [],
): Promise<string> {
  return runBase(root, snapshot, await headCommit(root), stacked);
}

export async function runBaseUntil(
  root: string,
  snapshot: string,
  until: string | null,
  stacked: readonly string[] = [],
): Promise<string> {
  if (!until) return liveRunBase(root, snapshot, stacked);
  const head = await maybe(root, ['rev-parse', '--verify', '-q', `${until}^1`]);
  return runBase(root, snapshot, head, stacked);
}
