import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_READ_MAX_BYTES,
  PathRefusedError,
  parseSparkIgnore,
  primaryRoot,
  resolveProjectPath,
  sliceLines,
  type PathAccess,
  type PathPolicy,
  type ProjectRoot,
  type ResolvedPath,
} from './path-policy.ts';

export interface ProjectText extends ResolvedPath {
  content: string;
}

export async function readIgnore(root: string): Promise<string[]> {
  try {
    return parseSparkIgnore(await readFile(path.join(root, '.sparkignore'), 'utf8'));
  } catch {
    return [];
  }
}

export class RootMissingError extends Error {
  constructor(readonly root: string) {
    super(`The folder ${root} is missing.`);
  }
}

async function openRoot(root: string): Promise<ProjectRoot> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new RootMissingError(root);
  }
  return { path: realRoot, ignore: await readIgnore(realRoot) };
}

export async function projectPolicy(roots: readonly string[]): Promise<PathPolicy> {
  return { roots: await Promise.all(roots.map(openRoot)), realpath };
}

export async function resolveInProject(
  policy: PathPolicy,
  requested: string,
  access: PathAccess,
): Promise<ResolvedPath> {
  const absolute = path.isAbsolute(requested)
    ? requested
    : path.join(primaryRoot(policy), requested);
  return resolveProjectPath(policy, absolute, access);
}

export async function readProjectFile(
  policy: PathPolicy,
  requested: string,
): Promise<ResolvedPath & { data: Buffer }> {
  const resolved = await resolveInProject(policy, requested, 'read');
  const info = await stat(resolved.absolute);
  if (!info.isFile()) throw new PathRefusedError(requested, 'not a file');
  if (info.size > PROJECT_READ_MAX_BYTES) throw new PathRefusedError(requested, 'larger than 1 MB');
  return { ...resolved, data: await readFile(resolved.absolute) };
}

export async function readProjectText(
  policy: PathPolicy,
  requested: string,
  line?: number | null,
  limit?: number | null,
): Promise<ProjectText> {
  const file = await readProjectFile(policy, requested);
  const content = sliceLines(file.data.toString('utf8'), line, limit);
  return { root: file.root, absolute: file.absolute, relative: file.relative, content };
}
