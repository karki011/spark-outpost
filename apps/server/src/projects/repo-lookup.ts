import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@spark-outpost/contracts';
import { conversationProjectIds } from '../agent-config/store.ts';
import type { Queryable } from '../persistence/db.ts';
import { isWithin } from './clone/clone-destination.ts';
import { FolderError } from './folders.ts';
import { displayPath, listProjects, projectRoot, realHome } from './projects.ts';
import {
  originOf,
  repoMatch,
  scanRepos,
  type RepoCandidate,
  type RepoMatchKind,
  type RepoScanLimits,
} from './repo-scan.ts';
import { effectiveReposFolders, type ReposFolderRules } from './repos-folders.ts';

const SCAN_DEPTH = 3;
const SCAN_ENTRIES = 50_000;
const SCAN_MS = 4_000;

export interface RepoLookupRules extends ReposFolderRules {
  limits?: Partial<RepoScanLimits>;
}

export interface FoundRepoMatch {
  name: string;
  path: string;
  origin: string | null;
  sparkProject: boolean;
  linked: boolean;
}

export interface RepoLookup {
  matches: FoundRepoMatch[];
  partial: boolean;
  folders: string[];
}

interface Ranked extends RepoCandidate {
  kind: RepoMatchKind;
  project: Project | null;
}

function scanLimits(rules: RepoLookupRules): RepoScanLimits {
  const now = rules.limits?.now ?? Date.now;
  return {
    maxDepth: SCAN_DEPTH,
    maxEntries: SCAN_ENTRIES,
    deadline: now() + SCAN_MS,
    now,
    ...rules.limits,
  };
}

async function projectCandidates(projects: readonly Project[]): Promise<RepoCandidate[]> {
  return Promise.all(
    projects.map(async (project) => ({
      name: project.name,
      path: project.rootPath,
      origin: await originOf(project.rootPath),
    })),
  );
}

function ranked(candidates: readonly Ranked[]): Ranked[] {
  return [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'exact' ? -1 : 1;
    if ((a.project === null) !== (b.project === null)) return a.project ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function findRepos(
  db: Queryable,
  workspaceId: string,
  conversationId: string | null,
  query: string,
  rules: RepoLookupRules,
): Promise<RepoLookup> {
  const home = await realHome();
  const projects = await listProjects(db, workspaceId);
  const byRoot = new Map(projects.map((project) => [project.rootPath, project]));
  const linked = new Set(conversationId ? await conversationProjectIds(db, conversationId) : []);
  const folders = (await effectiveReposFolders(db, workspaceId, rules)).map((entry) => entry.path);
  const skipped = [path.join(home, 'Library'), rules.dataDir];
  const scan = await scanRepos(folders, skipped, scanLimits(rules));
  const scanned = scan.repos
    .filter((repo) => !byRoot.has(repo.path))
    .map((repo) => ({ ...repo, name: path.basename(repo.path) }));
  const candidates = [...(await projectCandidates(projects)), ...scanned];
  const matches: Ranked[] = [];
  for (const candidate of candidates) {
    const kind = repoMatch(candidate, query);
    if (kind) matches.push({ ...candidate, kind, project: byRoot.get(candidate.path) ?? null });
  }
  return {
    matches: ranked(matches).map((match) => ({
      name: match.name,
      path: displayPath(match.path, home),
      origin: match.origin,
      sparkProject: match.project !== null,
      linked: match.project !== null && linked.has(match.project.id),
    })),
    partial: scan.partial,
    folders: folders.map((folder) => displayPath(folder, home)),
  };
}

export interface LinkTarget {
  repo: string;
  path: string;
  displayPath: string;
  origin: string | null;
  projectId: string | null;
}

export class LinkRefusedError extends Error {}

function expandHome(requested: string, home: string): string {
  if (requested === '~') return home;
  return requested.startsWith('~/') ? path.join(home, requested.slice(2)) : requested;
}

async function isGitRepo(root: string): Promise<boolean> {
  return lstat(path.join(root, '.git'))
    .then((stats) => !stats.isSymbolicLink())
    .catch(() => false);
}

function projectNamed(projects: readonly Project[], wanted: string): Project | null {
  const byId = projects.find((project) => project.id === wanted);
  if (byId) return byId;
  const named = projects.filter((project) => project.name.toLowerCase() === wanted.toLowerCase());
  if (named.length > 1) {
    throw new LinkRefusedError(
      `More than one project is named ${wanted}. Use spark_find_repo and pass its path.`,
    );
  }
  return named[0] ?? null;
}

async function folderTarget(requested: string, home: string): Promise<string> {
  try {
    return await projectRoot(expandHome(requested, home));
  } catch (error) {
    if (error instanceof FolderError) throw new LinkRefusedError(error.message);
    throw error;
  }
}

export async function linkTarget(
  db: Queryable,
  workspaceId: string,
  requested: string,
  rules: ReposFolderRules,
): Promise<LinkTarget> {
  const home = await realHome();
  const projects = await listProjects(db, workspaceId);
  const wanted = requested.trim();
  const looksLikePath = wanted.startsWith('/') || wanted.startsWith('~');
  const named = looksLikePath ? null : projectNamed(projects, wanted);
  const root = named ? named.rootPath : await folderTarget(wanted, home);
  const project = named ?? projects.find((candidate) => candidate.rootPath === root) ?? null;
  if (!project) {
    const folders = await effectiveReposFolders(db, workspaceId, rules);
    if (!folders.some((folder) => isWithin(root, folder.path)) || isWithin(root, rules.dataDir)) {
      throw new LinkRefusedError(
        `${displayPath(root, home)} is not in a repos folder (Settings → Projects). Ask the user to add its folder there, or to link it from the chat.`,
      );
    }
    if (!(await isGitRepo(root))) {
      throw new LinkRefusedError(`${displayPath(root, home)} is not a git repository.`);
    }
  }
  return {
    repo: project?.name ?? path.basename(root),
    path: root,
    displayPath: displayPath(root, home),
    origin: await originOf(root),
    projectId: project?.id ?? null,
  };
}
