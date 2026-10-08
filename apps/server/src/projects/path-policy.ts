import path from 'node:path';
import {
  CREDENTIAL_LOCATIONS,
  SECRET_FILE_EXCEPTIONS,
  SECRET_FILE_PATTERNS,
} from './secret-files.ts';

export const PROJECT_READ_MAX_BYTES = 1024 * 1024;

export type PathAccess = 'read' | 'write' | 'agent_read';

export type RefusalReason =
  | 'not absolute'
  | 'outside the project'
  | 'secret file'
  | 'inside .git'
  | 'not a file'
  | 'larger than 1 MB';

export class PathRefusedError extends Error {
  constructor(
    readonly requested: string,
    readonly reason: RefusalReason,
  ) {
    super(`Refused ${requested} (${reason})`);
  }
}

export interface ResolvedPath {
  root: string;
  absolute: string;
  relative: string;
}

export interface ProjectRoot {
  path: string;
  ignore: readonly string[];
}

export interface PathPolicy {
  roots: readonly ProjectRoot[];
  realpath: (target: string) => Promise<string>;
}

export function parseSparkIgnore(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));
}

export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

interface IgnoreRule {
  anchored: boolean;
  regex: RegExp;
}

const MAX_IGNORE_RULES = 1_000;
const ignoreRules = new Map<string, IgnoreRule | null>();

function compileIgnore(pattern: string): IgnoreRule | null {
  const trimmed = pattern.replace(/\/+$/, '');
  if (trimmed === '') return null;
  return { anchored: trimmed.includes('/'), regex: globToRegExp(trimmed.replace(/^\//, '')) };
}

function ignoreRule(pattern: string): IgnoreRule | null {
  if (ignoreRules.has(pattern)) return ignoreRules.get(pattern)!;
  if (ignoreRules.size >= MAX_IGNORE_RULES) ignoreRules.clear();
  const rule = compileIgnore(pattern);
  ignoreRules.set(pattern, rule);
  return rule;
}

function matchesIgnore(relative: string, pattern: string): boolean {
  const rule = ignoreRule(pattern);
  if (!rule) return false;
  const segments = relative.split('/');
  const { anchored, regex } = rule;
  if (!anchored) return segments.some((segment) => regex.test(segment));
  return segments.some((_, index) => regex.test(segments.slice(0, index + 1).join('/')));
}

const SECRET_NAME_PATTERNS = SECRET_FILE_PATTERNS.map(globToRegExp);

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_FILE_EXCEPTIONS.includes(lower)) return false;
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(lower));
}

export function isIgnoredPath(relative: string, ignore: readonly string[]): boolean {
  return ignore.some((pattern) => matchesIgnore(relative, pattern));
}

export function isSecretPath(relative: string, ignore: readonly string[] = []): boolean {
  const name = relative.split('/').pop() ?? '';
  return isSecretName(name) || isIgnoredPath(relative, ignore);
}

const CREDENTIAL_LOCATION_RULES = CREDENTIAL_LOCATIONS.map((location) =>
  location.toLowerCase().split('/').map(globToRegExp),
);

export function isCredentialPath(absolute: string): boolean {
  const segments = absolute.toLowerCase().split('/').filter(Boolean);
  if (isSecretName(segments.at(-1) ?? '')) return true;
  return CREDENTIAL_LOCATION_RULES.some((rule) =>
    segments.some((_, start) =>
      rule.every((part, offset) => part.test(segments[start + offset] ?? '')),
    ),
  );
}

export type ProtectedKind = 'instructions' | 'git_control';

const INSTRUCTION_NAMES = new Set(['AGENTS.md', 'CLAUDE.md']);
const INSTRUCTION_PREFIXES = ['.claude/', '.cursor/rules/', '.spark/'];
const INSTRUCTION_FILES = new Set(['.github/copilot-instructions.md']);
const GIT_HOOK = /^\.git\/hooks\/[^/]+$/;
const GIT_CONFIG = '.git/config';
const SPARK_OWN_DIRS = ['.spark/worktrees/', '.spark/plans/'];

export function protectedPath(relative: string): ProtectedKind | null {
  if (GIT_HOOK.test(relative) || relative === GIT_CONFIG) return 'git_control';
  const name = relative.split('/').pop() ?? '';
  if (INSTRUCTION_NAMES.has(name) || INSTRUCTION_FILES.has(relative)) return 'instructions';
  if (SPARK_OWN_DIRS.some((dir) => relative.startsWith(dir))) return null;
  const inside = INSTRUCTION_PREFIXES.some((prefix) => relative.startsWith(prefix));
  return inside || INSTRUCTION_PREFIXES.includes(`${relative}/`) ? 'instructions' : null;
}

export function relativeInside(root: string, target: string): string | null {
  const relative = path.relative(root, target);
  if (relative === '' || path.isAbsolute(relative)) return null;
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  return relative.split(path.sep).join('/');
}

export function refusalFor(
  relative: string | null,
  access: PathAccess,
  ignore: readonly string[],
): RefusalReason | null {
  if (relative === null) return 'outside the project';
  const kept =
    access === 'agent_read' ? isIgnoredPath(relative, ignore) : isSecretPath(relative, ignore);
  if (kept) return 'secret file';
  const git = relative.split('/')[0] === '.git';
  if (access === 'write' && git && protectedPath(relative) === null) return 'inside .git';
  return null;
}

export function primaryRoot(policy: PathPolicy): string {
  const first = policy.roots[0];
  if (!first) throw new Error('A path policy needs at least one root.');
  return first.path;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

async function realTarget(policy: PathPolicy, target: string, access: PathAccess): Promise<string> {
  try {
    return await policy.realpath(target);
  } catch (error) {
    if (access !== 'write' || !isMissing(error)) throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await realTarget(policy, parent, access), path.basename(target));
  }
}

function placeInRoots(
  policy: PathPolicy,
  requested: string,
  target: string,
  access: PathAccess,
): { root: string; relative: string } {
  let closest: { root: string; relative: string } | null = null;
  for (const root of policy.roots) {
    const relative = relativeInside(root.path, target);
    if (relative === null) continue;
    const reason = refusalFor(relative, access, root.ignore);
    if (reason) throw new PathRefusedError(requested, reason);
    if (!closest || root.path.length > closest.root.length) closest = { root: root.path, relative };
  }
  if (!closest) throw new PathRefusedError(requested, 'outside the project');
  return closest;
}

export async function resolveProjectPath(
  policy: PathPolicy,
  requested: string,
  access: PathAccess,
): Promise<ResolvedPath> {
  if (!path.isAbsolute(requested)) throw new PathRefusedError(requested, 'not absolute');
  const lexical = path.resolve(requested);
  placeInRoots(policy, requested, lexical, access);
  const absolute = await realTarget(policy, lexical, access);
  return { ...placeInRoots(policy, requested, absolute, access), absolute };
}

export function sliceLines(text: string, line?: number | null, limit?: number | null): string {
  if (!line && !limit) return text;
  const lines = text.split('\n');
  const start = Math.max(1, line ?? 1) - 1;
  const end = limit ? start + Math.max(0, limit) : lines.length;
  return lines.slice(start, end).join('\n');
}
