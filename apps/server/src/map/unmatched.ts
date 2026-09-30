import {
  MAP_UNMATCHED_MAX,
  type MapUnmatched,
  type MapUnmatchedEndpoint,
} from '@spark-outpost/contracts';
import type { Endpoint } from '../codescan/endpoints.ts';
import { isTestFile } from '../codescan/test-pairs.ts';
import type { Queryable } from '../persistence/db.ts';
import { httpFit, segments, type LinkFile, type LinkRepo } from './link-match.ts';
import { loadLinkRepo } from './links.ts';

export interface UnmatchedRepo {
  projectId: string;
  repo: LinkRepo;
}

export interface StoredHttpLink {
  fromRepo: string;
  toRepo: string;
  fromPath: string;
  toPath: string;
  fromLine: number | null;
  toLine: number | null;
}

interface Located {
  repo: UnmatchedRepo;
  file: LinkFile;
  endpoint: Endpoint;
}

const key = (repoId: string, path: string, line: number | null) =>
  `${repoId}\u0000${path}\u0000${line ?? ''}`;

function endpoints(repo: UnmatchedRepo, kind: Endpoint['kind']): Located[] {
  return repo.repo.files
    .filter((file) => !isTestFile(file.path))
    .flatMap((file) =>
      file.endpoints
        .filter((endpoint) => endpoint.kind === kind)
        .map((endpoint) => ({ repo, file, endpoint })),
    );
}

function lastSegment(path: string): string {
  return segments(path).at(-1) ?? '';
}

function matchWithin(repo: UnmatchedRepo, called: Set<string>, reached: Set<string>): void {
  const routes = endpoints(repo, 'route');
  const mounts = endpoints(repo, 'mount').map(({ endpoint }) => segments(endpoint.path));
  const byLast = new Map<string, Located[]>();
  for (const route of routes) {
    const last = lastSegment(route.endpoint.path);
    byLast.set(last, [...(byLast.get(last) ?? []), route]);
  }
  const open = byLast.get(':') ?? [];
  for (const call of endpoints(repo, 'call')) {
    const last = lastSegment(call.endpoint.path);
    const candidates = last === ':' ? routes : [...(byLast.get(last) ?? []), ...open];
    for (const route of candidates) {
      if (!httpFit(call.endpoint, route.endpoint, mounts)) continue;
      called.add(key(repo.repo.id, route.file.path, route.endpoint.line));
      reached.add(key(repo.repo.id, call.file.path, call.endpoint.line));
    }
  }
}

function judgeable(route: Endpoint): boolean {
  return segments(route.path).some((segment) => segment !== ':');
}

function toEndpoint(item: Located): MapUnmatchedEndpoint {
  return {
    projectId: item.repo.projectId,
    method: item.endpoint.method ?? 'ANY',
    path: item.endpoint.path,
    file: item.file.path,
    line: item.endpoint.line,
    confirmedBy: null,
  };
}

function ranked(items: Located[]): MapUnmatchedEndpoint[] {
  return items
    .sort(
      (a, b) =>
        b.file.importance - a.file.importance ||
        a.file.path.localeCompare(b.file.path) ||
        a.endpoint.line - b.endpoint.line,
    )
    .slice(0, MAP_UNMATCHED_MAX)
    .map(toEndpoint);
}

export function unmatchedEndpoints(
  repos: readonly UnmatchedRepo[],
  links: readonly StoredHttpLink[],
): MapUnmatched {
  const called = new Set(links.map((link) => key(link.toRepo, link.toPath, link.toLine)));
  const reached = new Set(links.map((link) => key(link.fromRepo, link.fromPath, link.fromLine)));
  for (const repo of repos) matchWithin(repo, called, reached);
  const routes = repos
    .flatMap((repo) => endpoints(repo, 'route'))
    .filter(({ endpoint }) => judgeable(endpoint))
    .filter(({ repo, file, endpoint }) => !called.has(key(repo.repo.id, file.path, endpoint.line)));
  const calls = repos
    .flatMap((repo) => endpoints(repo, 'call'))
    .filter(
      ({ repo, file, endpoint }) => !reached.has(key(repo.repo.id, file.path, endpoint.line)),
    );
  return {
    routes: ranked(routes),
    calls: ranked(calls),
    routeTotal: routes.length,
    callTotal: calls.length,
  };
}

export async function mapUnmatched(
  db: Queryable,
  projects: readonly { id: string; rootPath: string }[],
): Promise<MapUnmatched> {
  const { rows: found } = await db.query<{ id: string; root_path: string }>(
    `SELECT id, root_path FROM map_repos
     WHERE root_path = ANY($1::text[]) AND built_signature IS NOT NULL`,
    [projects.map((project) => project.rootPath)],
  );
  const byRoot = new Map(found.map((row) => [row.root_path, row.id]));
  const seen = new Set<string>();
  const sides = projects.flatMap((project) => {
    const repoId = byRoot.get(project.rootPath);
    if (!repoId || seen.has(repoId)) return [];
    seen.add(repoId);
    return [{ projectId: project.id, repoId, rootPath: project.rootPath }];
  });
  const repos = await Promise.all(
    sides.map(async (side) => ({
      projectId: side.projectId,
      repo: await loadLinkRepo(db, { ...side, signature: '' }),
    })),
  );
  const ids = sides.map((side) => side.repoId);
  const { rows } = await db.query<{
    from_repo: string;
    to_repo: string;
    from_path: string;
    to_path: string;
    from_line: number | null;
    to_line: number | null;
  }>(
    `SELECT from_repo, to_repo, from_path, to_path, from_line, to_line FROM map_links
     WHERE kind = 'http' AND from_repo = ANY($1::uuid[]) AND to_repo = ANY($1::uuid[])`,
    [ids],
  );
  return unmatchedEndpoints(
    repos,
    rows.map((row) => ({
      fromRepo: row.from_repo,
      toRepo: row.to_repo,
      fromPath: row.from_path,
      toPath: row.to_path,
      fromLine: row.from_line,
      toLine: row.to_line,
    })),
  );
}
