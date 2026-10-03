import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { providerLabel, type RailKind } from '@spark-outpost/contracts';
import { isSecretPath, protectedPath } from '../projects/path-policy.ts';
import type { Db } from '../persistence/db.ts';
import { insertRailFlag, type NewRailFlag } from '../persistence/rail-flags.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import { runGit } from '../ship/git.ts';

const ORIGINAL_MAX_CHARS = 64 * 1024;

interface GitControlFile {
  hash: string;
  text: string;
}

interface RootState {
  root: string;
  gitDir: string;
  control: Map<string, GitControlFile>;
  dirty: Set<string>;
}

export interface RailFlagsOptions {
  db: Db;
  runId: string;
  provider: string;
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

async function readConfig(gitDir: string): Promise<GitControlFile | null> {
  const file = path.join(gitDir, 'config');
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  const listed = await runGit(gitDir, ['config', '--file', file, '--list']);
  const settings = listed.stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('branch.'))
    .sort();
  return { hash: hashOf(settings.join('\n')), text };
}

async function controlFiles(gitDir: string): Promise<Map<string, GitControlFile>> {
  const files = new Map<string, GitControlFile>();
  const config = await readConfig(gitDir);
  if (config) files.set('.git/config', config);
  const hooks = await readdir(path.join(gitDir, 'hooks')).catch(() => [] as string[]);
  for (const name of hooks.filter((hook) => !hook.endsWith('.sample'))) {
    const hook = await readControl(path.join(gitDir, 'hooks', name));
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
  const common = await runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common.code !== 0) return null;
  const gitDir = common.stdout.trim();
  return { root, gitDir, control: await controlFiles(gitDir), dirty: await dirtyPaths(root) };
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

async function agentName(db: Db, runId: string, provider: string): Promise<string> {
  const { rows } = await db.query<{ name: string | null }>(
    `SELECT route->>'name' AS name FROM runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.name ?? providerLabel(provider);
}

export async function startRailFlags(options: RailFlagsOptions): Promise<RailFlagRecorder> {
  const { db, runId, audit } = options;
  const agent = await agentName(db, runId, options.provider);
  const roots = (await Promise.all(options.projectRoots.map(rootState))).filter(
    (state): state is RootState => state !== null,
  );
  const record = async (flag: NewRailFlag) => {
    const saved = await insertRailFlag(db, runId, agent, flag);
    if (!saved) return;
    audit.message('harness', {
      method: 'spark/rail_crossed',
      params: { flagId: saved.id, rail: saved.rail, title: saved.title, paths: saved.paths },
    });
  };
  return {
    record,
    async finish() {
      const approved = await approvedPaths(db, runId);
      for (const before of roots) {
        const control = changedControl(before, await controlFiles(before.gitDir));
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
