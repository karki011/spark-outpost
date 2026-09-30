import type {
  MapArea,
  MapAreaDetail,
  MapCategory,
  MapFileKind,
  MapKind,
  MapLinks,
  MapStatus,
  ProjectMap,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { emptyKindCounts } from './file-kind.ts';
import { nameCandidates } from './label-questions.ts';

interface StatusRow {
  id: string;
  status: MapStatus['status'];
  phase: MapStatus['phase'];
  progress_done: number;
  progress_total: number;
  rules_version: string;
  built_commit: string | null;
  built_at: Date | null;
  file_count: number;
  area_count: number;
  edge_count: number;
  timings: Record<string, number>;
  jev_areas: number | null;
  error: string | null;
}

function toStatus(row: StatusRow): MapStatus {
  return {
    mapId: row.id,
    status: row.status,
    phase: row.phase,
    progress: { done: row.progress_done, total: row.progress_total },
    rulesVersion: row.rules_version,
    builtCommit: row.built_commit,
    builtAt: row.built_at?.toISOString() ?? null,
    fileCount: row.file_count,
    areaCount: row.area_count,
    edgeCount: row.edge_count,
    timings: row.timings,
    jevAreas: row.jev_areas,
    error: row.error,
  };
}

export async function mapStatus(db: Queryable, root: string): Promise<MapStatus | null> {
  const { rows } = await db.query<StatusRow>(
    `SELECT id, status, phase, progress_done, progress_total, rules_version, built_commit,
       built_at, file_count, area_count, edge_count, timings, jev_areas, error
     FROM map_repos WHERE root_path = $1`,
    [root],
  );
  return rows[0] ? toStatus(rows[0]) : null;
}

interface AreaRow {
  id: string;
  root: string;
  source: MapArea['source'];
  package: string;
  reason: string;
  file_count: number;
  line_count: number;
  fan_in: number;
  fan_out: number;
  importance: number;
  top_files: string[];
  kind_counts: Partial<Record<MapFileKind, number>>;
  rule_category: MapCategory;
  rule_kind: MapKind;
  x: number;
  y: number;
  radius: number;
  label_source: 'jev' | 'rules' | null;
  label_category: MapCategory | null;
  label_kind: MapKind | null;
  label_name: string | null;
  label_description: string | null;
  label_confidence: number | null;
  override_category: MapCategory | null;
}

const AREA_SELECT = `SELECT a.id, a.root, a.source, a.package, a.reason, a.file_count, a.line_count,
    a.fan_in, a.fan_out, a.importance, a.top_files, a.kind_counts, a.rule_category, a.rule_kind,
    a.x, a.y, a.radius, l.source AS label_source, l.category AS label_category, l.kind AS label_kind,
    l.name AS label_name, l.description AS label_description,
    l.confidence AS label_confidence, o.category AS override_category
  FROM map_areas a
  JOIN map_repos r ON r.id = a.repo_id
  LEFT JOIN map_labels l ON l.repo_id = a.repo_id AND l.area_id = a.id
  LEFT JOIN map_overrides o ON o.root_path = r.root_path AND o.area_id = a.id`;

function toArea(row: AreaRow): MapArea {
  const categorySource = row.override_category ? 'override' : (row.label_source ?? 'rules');
  return {
    id: row.id,
    root: row.root,
    source: row.source,
    package: row.package,
    reason: row.reason,
    name: row.label_name ?? nameCandidates(row.root, row.package, row.top_files)[0] ?? row.root,
    description: row.label_description ?? row.reason,
    category: row.override_category ?? row.label_category ?? row.rule_category,
    categorySource,
    kind: row.label_kind ?? row.rule_kind,
    confidence: row.label_confidence,
    fileCount: row.file_count,
    lineCount: row.line_count,
    fanIn: row.fan_in,
    fanOut: row.fan_out,
    importance: row.importance,
    topFiles: row.top_files,
    kindCounts: { ...emptyKindCounts(), ...row.kind_counts },
    x: row.x,
    y: row.y,
    radius: row.radius,
  };
}

export async function projectMap(
  db: Queryable,
  projectId: string,
  root: string,
): Promise<ProjectMap> {
  const status = await mapStatus(db, root);
  if (!status) return { projectId, status: null, areas: [], areaEdges: [] };
  const [areas, edges] = await Promise.all([
    db.query<AreaRow>(`${AREA_SELECT} WHERE a.repo_id = $1 ORDER BY a.importance DESC, a.root`, [
      status.mapId,
    ]),
    db.query<{ from_area: string; to_area: string; weight: number }>(
      'SELECT from_area, to_area, weight FROM map_area_edges WHERE repo_id = $1 ORDER BY from_area, to_area',
      [status.mapId],
    ),
  ]);
  return {
    projectId,
    status,
    areas: areas.rows.map(toArea),
    areaEdges: edges.rows.map((row) => ({
      from: row.from_area,
      to: row.to_area,
      weight: row.weight,
    })),
  };
}

export async function findArea(
  db: Queryable,
  root: string,
  areaId: string,
): Promise<MapArea | null> {
  const { rows } = await db.query<AreaRow>(`${AREA_SELECT} WHERE r.root_path = $1 AND a.id = $2`, [
    root,
    areaId,
  ]);
  return rows[0] ? toArea(rows[0]) : null;
}

export async function areasById(
  db: Queryable,
  root: string,
  areaIds: readonly string[],
): Promise<MapArea[]> {
  const { rows } = await db.query<AreaRow>(
    `${AREA_SELECT} WHERE r.root_path = $1 AND a.id = ANY($2::text[])`,
    [root, areaIds],
  );
  return rows.map(toArea);
}

export async function areaDetail(
  db: Queryable,
  root: string,
  area: MapArea,
  page: { offset: number; limit: number },
): Promise<MapAreaDetail> {
  const files = await db.query<{
    path: string;
    area_id: string;
    language: string;
    kind: MapFileKind;
    lines: number;
    fan_in: number;
    fan_out: number;
    importance: number;
    reasons: string[];
    last_changed_at: Date | null;
    change_count: number;
    author_count: number;
    x: number;
    y: number;
  }>(
    `SELECT f.path, f.area_id, f.language, f.kind, f.lines, f.fan_in, f.fan_out, f.importance,
       f.reasons, f.last_changed_at, f.change_count, f.author_count, f.x, f.y
     FROM map_files f JOIN map_repos r ON r.id = f.repo_id
     WHERE r.root_path = $1 AND f.area_id = $2
     ORDER BY f.importance DESC, f.path OFFSET $3 LIMIT $4`,
    [root, area.id, page.offset, page.limit],
  );
  const paths = files.rows.map((row) => row.path);
  const edges = await db.query<{ from_path: string; to_path: string }>(
    `SELECT e.from_path, e.to_path FROM map_edges e JOIN map_repos r ON r.id = e.repo_id
     WHERE r.root_path = $1 AND (e.from_path = ANY($2::text[]) OR e.to_path = ANY($2::text[]))
     ORDER BY e.from_path, e.to_path`,
    [root, paths],
  );
  const next = page.offset + files.rows.length;
  return {
    area,
    files: files.rows.map((row) => ({
      path: row.path,
      areaId: row.area_id,
      language: row.language,
      kind: row.kind,
      lines: row.lines,
      fanIn: row.fan_in,
      fanOut: row.fan_out,
      importance: row.importance,
      reasons: row.reasons,
      lastChangedAt: row.last_changed_at?.toISOString() ?? null,
      changeCount: row.change_count,
      authorCount: row.author_count,
      x: row.x,
      y: row.y,
    })),
    edges: edges.rows.map((row) => ({ from: row.from_path, to: row.to_path })),
    totalFiles: area.fileCount,
    nextOffset: next < area.fileCount ? next : null,
  };
}

export async function setAreaOverride(
  db: Queryable,
  root: string,
  areaId: string,
  category: MapCategory | null,
): Promise<void> {
  if (category === null) {
    await db.query('DELETE FROM map_overrides WHERE root_path = $1 AND area_id = $2', [
      root,
      areaId,
    ]);
    return;
  }
  await db.query(
    `INSERT INTO map_overrides (root_path, area_id, category) VALUES ($1, $2, $3)
     ON CONFLICT (root_path, area_id) DO UPDATE SET category = EXCLUDED.category, updated_at = now()`,
    [root, areaId, category],
  );
}

export async function mapLinks(
  db: Queryable,
  projects: readonly { id: string; rootPath: string }[],
): Promise<MapLinks> {
  const { rows: repos } = await db.query<{
    id: string;
    root_path: string;
    status: MapStatus['status'];
  }>('SELECT id, root_path, status FROM map_repos WHERE root_path = ANY($1::text[])', [
    projects.map((project) => project.rootPath),
  ]);
  const repoByRoot = new Map(repos.map((repo) => [repo.root_path, repo]));
  const projectByRepo = new Map(
    projects.flatMap((project) => {
      const repo = repoByRoot.get(project.rootPath);
      return repo ? [[repo.id, project.id] as const] : [];
    }),
  );
  const ids = [...projectByRepo.keys()];
  const { rows } = await db.query<{
    kind: MapLinks['links'][number]['kind'];
    label: string;
    from_repo: string;
    to_repo: string;
    from_path: string;
    to_path: string;
    from_area: string;
    to_area: string;
    from_line: number | null;
    to_line: number | null;
    confidence: number;
    source: 'rules' | 'jev';
  }>(
    `SELECT kind, label, from_repo, to_repo, from_path, to_path, from_area, to_area, from_line,
       to_line, confidence, source
     FROM map_links WHERE from_repo = ANY($1::uuid[]) AND to_repo = ANY($1::uuid[])
     ORDER BY kind, label, from_path, to_path`,
    [ids],
  );
  const links = rows.map((row) => ({
    kind: row.kind,
    label: row.label,
    fromProjectId: projectByRepo.get(row.from_repo) as string,
    toProjectId: projectByRepo.get(row.to_repo) as string,
    fromPath: row.from_path,
    toPath: row.to_path,
    fromArea: row.from_area,
    toArea: row.to_area,
    fromLine: row.from_line,
    toLine: row.to_line,
    confidence: row.confidence,
    source: row.source,
  }));
  return {
    projects: projects.map((project) => {
      const repo = repoByRoot.get(project.rootPath);
      return { projectId: project.id, mapId: repo?.id ?? null, status: repo?.status ?? null };
    }),
    links,
    areaLinks: areaLinks(links),
  };
}

function areaLinks(links: MapLinks['links']): MapLinks['areaLinks'] {
  const grouped = new Map<string, MapLinks['areaLinks'][number]>();
  for (const link of links) {
    const key = [link.fromProjectId, link.fromArea, link.toProjectId, link.toArea].join('\u0000');
    const entry = grouped.get(key) ?? {
      fromProjectId: link.fromProjectId,
      fromArea: link.fromArea,
      toProjectId: link.toProjectId,
      toArea: link.toArea,
      kinds: [],
      count: 0,
      confidence: 0,
    };
    if (!entry.kinds.includes(link.kind)) entry.kinds.push(link.kind);
    entry.count += 1;
    entry.confidence = Math.max(entry.confidence, link.confidence);
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}
