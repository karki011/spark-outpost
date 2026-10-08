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
    const owners = pieces.filter((piece) => piece.owns(file));
    for (const owner of owners) files.get(owner.key)!.push(file);
    if (owners.length === 0) unclaimed.push(file);
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

function filesByTree(sources: ReadonlyMap<string, string>): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [file, tree] of sources) {
    const files = grouped.get(tree);
    if (files) files.push(file);
    else grouped.set(tree, [file]);
  }
  return grouped;
}

async function stageFrom(
  root: string,
  tree: string,
  files: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const listed = await git(root, ['ls-tree', '-r', '--full-name', tree, '--', ...files]);
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
}

async function commitWithFiles(
  root: string,
  base: string,
  sources: ReadonlyMap<string, string>,
  message: string,
): Promise<string> {
  if (sources.size === 0) return base;
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-pieces-'));
  const env = { GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    await git(root, ['read-tree', base], env);
    for (const [tree, files] of filesByTree(sources)) await stageFrom(root, tree, files, env);
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

function stateAfter(
  file: string,
  later: readonly string[],
  files: ReadonlyMap<string, readonly string[]>,
  started: ReadonlyMap<string, string>,
  source: string,
): string {
  const next = later.find((runId) => files.get(runId)?.includes(file));
  return (next && started.get(next)) ?? source;
}

export async function runSnapshots(
  root: string,
  base: string,
  source: string,
  runIds: readonly string[],
  files: ReadonlyMap<string, readonly string[]>,
  started: ReadonlyMap<string, string>,
): Promise<RunSnapshotCommit[]> {
  const snapshots: RunSnapshotCommit[] = [];
  const before = new Map<string, string>();
  for (const [index, runId] of runIds.entries()) {
    const commit = await commitWithFiles(
      root,
      base,
      before,
      `Spark Outpost: shared pieces before run ${runId}`,
    );
    snapshots.push({ runId, commit });
    const later = runIds.slice(index + 1);
    for (const file of files.get(runId) ?? []) {
      before.set(file, stateAfter(file, later, files, started, source));
    }
  }
  return snapshots;
}
