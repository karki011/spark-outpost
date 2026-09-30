import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HARNESS_AUTHOR, git } from './snapshot.ts';

export interface PieceFiles {
  key: string;
  owns: (file: string) => boolean;
}

export interface Attribution {
  files: Map<string, string[]>;
  unclaimed: string[];
}

export function attributeFiles(
  changed: readonly string[],
  pieces: readonly PieceFiles[],
  lastKey: string | null,
): Attribution {
  const files = new Map(pieces.map((piece) => [piece.key, [] as string[]]));
  const unclaimed: string[] = [];
  for (const file of changed) {
    const owner = pieces.find((piece) => piece.owns(file));
    if (owner) files.get(owner.key)!.push(file);
    else unclaimed.push(file);
  }
  if (lastKey && files.has(lastKey)) files.get(lastKey)!.push(...unclaimed);
  return { files, unclaimed };
}

function feed(root: string, args: string[], input: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', root, ...args],
      { env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' } },
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin?.end(input);
  });
}

export async function commitWithFiles(
  root: string,
  base: string,
  source: string,
  files: readonly string[],
  message: string,
): Promise<string> {
  if (files.length === 0) return base;
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-pieces-'));
  const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    await git(root, ['read-tree', base], env);
    const listed = await git(root, ['ls-tree', '-r', '--full-name', source, '--', ...files]);
    const present = new Set(
      listed
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')[1]!),
    );
    if (listed.trim()) await feed(root, ['update-index', '--index-info'], listed, env);
    const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
    const removed = files.filter((file) => !present.has(`${prefix}${file}`));
    if (removed.length > 0) {
      await git(root, ['update-index', '--force-remove', '--', ...removed], env);
    }
    const tree = (await git(root, ['write-tree'], env)).trim();
    return (
      await git(root, ['commit-tree', tree, '-p', base, '-m', message], HARNESS_AUTHOR)
    ).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface RunSnapshotCommit {
  runId: string;
  commit: string;
}

export async function runSnapshots(
  root: string,
  base: string,
  source: string,
  runIds: readonly string[],
  files: ReadonlyMap<string, readonly string[]>,
): Promise<RunSnapshotCommit[]> {
  const snapshots: RunSnapshotCommit[] = [];
  const before: string[] = [];
  for (const runId of runIds) {
    const commit = await commitWithFiles(
      root,
      base,
      source,
      before,
      `Spark Outpost: shared pieces before run ${runId}`,
    );
    snapshots.push({ runId, commit });
    before.push(...(files.get(runId) ?? []));
  }
  return snapshots;
}
