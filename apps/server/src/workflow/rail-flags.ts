import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RailKind } from '@spark-outpost/contracts';
import { readGitDirs, WORKTREE_CONFIG_LABEL } from '../approvals/git-dirs.ts';
import { REPO_GIT_CONFIG } from '../approvals/git-config.ts';
import { isSecretPath, protectedPath, type GitDirs } from '../projects/path-policy.ts';
import type { Db } from '../persistence/db.ts';
import type { NewRailFlag } from '../persistence/rail-flags.ts';
import { raiseRailFlag } from '../observations/raise-flag.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import { runGit } from '../ship/git.ts';

const ORIGINAL_MAX_CHARS = 64 * 1024;

interface GitControlFile {
  hash: string;
  text: string;
}

interface RootState {
  root: string;
  dirs: GitDirs;
  control: Map<string, GitControlFile>;
  dirty: Set<string>;
}

export interface RailFlagsOptions {
  db: Db;
  runId: string;
  projectRoots: readonly string[];
  audit: ProtocolObserver;
}

export interface RailFlagRecorder {
  record(flag: NewRailFlag): Promise<void>;
  finish(): Promise<void>;
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

async function readControl(file: string): Promise<GitControlFile | null> {
  const text = await readFile(file, 'utf8').catch(() => null);
  return text === null ? null : { hash: hashOf(text), text };
}

async function readConfig(file: string): Promise<GitControlFile | null> {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  const listed = await runGit(path.dirname(file), ['config', '--file', file, '--list']);
  const settings = listed.stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('branch.'))
    .sort();
  return { hash: hashOf(settings.join('\n')), text };
}

async function controlFiles(dirs: GitDirs): Promise<Map<string, GitControlFile>> {
  const files = new Map<string, GitControlFile>();
  const config = await readConfig(path.join(dirs.common, 'config'));
  if (config) files.set(REPO_GIT_CONFIG, config);
  const own =
    dirs.own === dirs.common ? null : await readConfig(path.join(dirs.own, 'config.worktree'));
  if (own) files.set(WORKTREE_CONFIG_LABEL, own);
  const hooks = await readdir(path.join(dirs.common, 'hooks')).catch(() => [] as string[]);
  for (const name of hooks.filter((hook) => !hook.endsWith('.sample'))) {
    const hook = await readControl(path.join(dirs.common, 'hooks', name));
    if (hook) files.set(`.git/hooks/${name}`, hook);
  }
  return files;
}

async function dirtyPaths(root: string): Promise<Set<string>> {
  const result = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.code !== 0) return new Set();
  return new Set(
    result.stdout
      .split('\0')
      .filter((entry) => entry.length > 3)
      .map((entry) => entry.slice(3)),
  );
}

async function rootState(root: string): Promise<RootState | null> {
  const dirs = await readGitDirs(root);
  if (!dirs) return null;
  return { root, dirs, control: await controlFiles(dirs), dirty: await dirtyPaths(root) };
}

function changedControl(before: RootState, after: Map<string, GitControlFile>): NewRailFlag | null {
  const names = new Set([...before.control.keys(), ...after.keys()]);
  const changed = [...names].filter(
    (name) => before.control.get(name)?.hash !== after.get(name)?.hash,
  );
  if (changed.length === 0) return null;
  const originals = changed.flatMap((name) => {
    const original = before.control.get(name);
    return original ? [{ path: name, text: original.text.slice(0, ORIGINAL_MAX_CHARS) }] : [];
  });
  return { toolCallId: null, rail: 'git_control', paths: changed, inside: false, originals };
}

function protectedRail(relative: string): RailKind | null {
  if (protectedPath(relative) === 'instructions') return 'instructions';
  return isSecretPath(relative) ? 'secret' : null;
}

function changedProtected(before: RootState, after: Set<string>): NewRailFlag[] {
  const byRail = new Map<RailKind, string[]>();
  for (const relative of after) {
    const rail = before.dirty.has(relative) ? null : protectedRail(relative);
    if (rail) byRail.set(rail, [...(byRail.get(rail) ?? []), relative]);
  }
  return [...byRail].map(([rail, paths]) => ({
    toolCallId: null,
    rail,
    paths,
    inside: true,
    originals: [],
  }));
}

async function approvedPaths(db: Db, runId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ target: string }>(
    `SELECT DISTINCT target FROM approvals a,
       jsonb_array_elements_text(
         COALESCE(a.payload->'gitControl', '[]'::jsonb)
         || COALESCE(a.payload->'instructionFiles', '[]'::jsonb)
         || COALESCE(a.payload->'paths', '[]'::jsonb)
       ) AS target
     WHERE a.run_id = $1 AND a.status = 'allowed'`,
    [runId],
  );
  return new Set(rows.map((row) => row.target));
}

export async function startRailFlags(options: RailFlagsOptions): Promise<RailFlagRecorder> {
  const { db, runId, audit } = options;
  const roots = (await Promise.all(options.projectRoots.map(rootState))).filter(
    (state): state is RootState => state !== null,
  );
  const record = (flag: NewRailFlag) => raiseRailFlag(db, runId, audit, flag);
  return {
    record,
    async finish() {
      const approved = await approvedPaths(db, runId);
      for (const before of roots) {
        const control = changedControl(before, await controlFiles(before.dirs));
        const found = [
          ...(control ? [control] : []),
          ...changedProtected(before, await dirtyPaths(before.root)),
        ];
        for (const flag of found) {
          const paths = flag.paths.filter((relative) => !approved.has(relative));
          if (paths.length > 0) await record({ ...flag, paths });
        }
      }
    },
  };
}
