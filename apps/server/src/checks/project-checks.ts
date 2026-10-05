import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Queryable } from '../persistence/db.ts';
import {
  CONFIG_FILES,
  LOCKFILE_NAMES,
  PACKAGE_RUNNERS,
  TOOL_FILES,
  configuredChecks,
  detectChecks,
  packageScripts,
  type CheckCommand,
  type ProjectFiles,
} from './detect.ts';

export interface ProjectChecks {
  commands: CheckCommand[];
  source: 'configured' | 'detected';
  scripts: string;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function optionalText(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch(() => null);
}

const LOCKFILE_SEARCH_DEPTH = 4;

async function filesIn(dir: string, names: readonly string[]): Promise<string[]> {
  const found = await Promise.all(
    names.map(async (file) => [file, await exists(path.join(dir, file))] as const),
  );
  return found.filter(([, present]) => present).map(([file]) => file);
}

async function inheritedLockfiles(root: string): Promise<string[]> {
  let dir = root;
  for (let depth = 0; depth < LOCKFILE_SEARCH_DEPTH; depth += 1) {
    if (await exists(path.join(dir, '.git'))) return [];
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    dir = parent;
    const found = await filesIn(dir, LOCKFILE_NAMES);
    if (found.length > 0) return found;
  }
  return [];
}

export async function readProjectFiles(root: string): Promise<ProjectFiles> {
  const present = await filesIn(root, [...CONFIG_FILES, ...TOOL_FILES]);
  const locked = LOCKFILE_NAMES.some((file) => present.includes(file));
  return {
    packageJson: await optionalText(path.join(root, 'package.json')),
    pyproject: await optionalText(path.join(root, 'pyproject.toml')),
    present: new Set([...present, ...(locked ? [] : await inheritedLockfiles(root))]),
  };
}

export async function scriptsFingerprint(root: string): Promise<string> {
  const scripts = packageScripts(await optionalText(path.join(root, 'package.json')));
  return JSON.stringify(Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b)));
}

export async function configuredCommands(db: Queryable, runId: string): Promise<string[] | null> {
  const { rows } = await db.query<{ check_commands: string[] | null }>(
    `SELECT p.check_commands FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     JOIN projects p ON p.id = cp.project_id
     WHERE r.id = $1
     ORDER BY cp.position, cp.created_at
     LIMIT 1`,
    [runId],
  );
  return rows[0]?.check_commands ?? null;
}

export async function projectChecks(
  db: Queryable,
  runId: string,
  root: string,
): Promise<ProjectChecks | null> {
  const configured = await configuredCommands(db, runId);
  const commands = configured
    ? configuredChecks(configured)
    : detectChecks(await readProjectFiles(root));
  if (commands.length === 0) return null;
  return {
    commands,
    source: configured ? 'configured' : 'detected',
    scripts: await scriptsFingerprint(root),
  };
}

export function runsPackageScript(check: CheckCommand): boolean {
  return PACKAGE_RUNNERS.has(path.basename(check.argv[0] ?? ''));
}
