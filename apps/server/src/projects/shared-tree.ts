import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { sameFile } from '../orchestration/step-files.ts';
import { git } from './snapshot.ts';

const HARNESS_AUTHOR = {
  GIT_AUTHOR_NAME: 'Spark Outpost',
  GIT_AUTHOR_EMAIL: 'snapshots@spark-outpost.local',
  GIT_COMMITTER_NAME: 'Spark Outpost',
  GIT_COMMITTER_EMAIL: 'snapshots@spark-outpost.local',
};

export interface LaneFiles {
  key: string;
  declared: readonly string[];
}

export interface Attribution {
  files: Map<string, string[]>;
  unclaimed: string[];
}

export function attributeFiles(
  changed: readonly string[],
  lanes: readonly LaneFiles[],
): Attribution {
  const files = new Map(lanes.map((lane) => [lane.key, [] as string[]]));
  const unclaimed: string[] = [];
  for (const file of changed) {
    const owner = lanes.find((lane) => lane.declared.some((declared) => sameFile(declared, file)));
    if (owner) files.get(owner.key)!.push(file);
    else unclaimed.push(file);
  }
  const last = lanes.at(-1);
  if (last && unclaimed.length > 0) files.get(last.key)!.push(...unclaimed);
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
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-lanes-'));
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

export interface LaneSnapshot {
  key: string;
  commit: string;
}

export async function laneSnapshots(
  root: string,
  base: string,
  source: string,
  order: readonly string[],
  files: ReadonlyMap<string, readonly string[]>,
): Promise<LaneSnapshot[]> {
  const snapshots: LaneSnapshot[] = [];
  const before: string[] = [];
  for (const key of order) {
    const commit = await commitWithFiles(
      root,
      base,
      source,
      before,
      `Spark Outpost: shared lanes before ${key}`,
    );
    snapshots.push({ key, commit });
    before.push(...(files.get(key) ?? []));
  }
  return snapshots;
}
