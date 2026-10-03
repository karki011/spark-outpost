import { setTimeout as pause } from 'node:timers/promises';
import type { Queryable } from '../persistence/db.ts';
import { statIndexable, textReader } from './file-stats.ts';
import {
  changedSince,
  headCommit,
  listProjectFiles,
  recentHistory,
  workingChanges,
  type Commit,
} from './git.ts';
import { packageMatcher, readLayout } from './layout.ts';
import { parseFiles } from './parse-pool.ts';
import type { FileResult } from './read-file.ts';
import {
  planRefresh,
  PROJECT_FILE_CAP,
  rebuildReason,
  withinCap,
  uncoveredDirectories,
  type FileStat,
} from './refresh-plan.ts';
import { evictBeyondCap, expireIndexes } from './retention.ts';
import {
  cachedFiles,
  countNameUse,
  deleteFiles,
  fileParserVersions,
  findIndexProject,
  finishIndex,
  insertNames,
  projectNames,
  pruneNames,
  relabelFiles,
  startIndexProject,
  touchFiles,
  upsertFiles,
  WRITE_BATCH,
  type CachedRow,
  type FileRow,
  type IndexProject,
} from './store.ts';
import { DEFINITION_KINDS, PARSER_VERSION } from './tag-queries.ts';
import { pairTests } from './test-pairs.ts';

const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const yieldToEventLoop = () => pause(0);

export interface IndexOptions {
  fileCap?: number;
  parserVersion?: string;
  pace?: (done: number, total: number) => Promise<void>;
}

export interface IndexOutcome {
  projectId: string;
  rebuilt: string | null;
  listed: number;
  indexable: number;
  capped: boolean;
  parsed: number;
  unchanged: number;
  removed: number;
  ms: number;
}

interface Context {
  db: Queryable;
  root: string;
  project: IndexProject;
  parserVersion: string;
  names: Map<string, number>;
  nextNameId: number;
  stats: Map<string, FileStat>;
  packageOf: (path: string) => string;
  tested: ReadonlySet<string>;
}

function largestId(names: ReadonlyMap<string, number>): number {
  let largest = 0;
  for (const id of names.values()) if (id > largest) largest = id;
  return largest;
}

function nameId(context: Context, name: string, fresh: [number, string][]): number {
  const known = context.names.get(name);
  if (known !== undefined) return known;
  const id = context.nextNameId++;
  context.names.set(name, id);
  fresh.push([id, name]);
  return id;
}

function toRow(
  context: Context,
  result: Extract<FileResult, { status: 'parsed' }>,
  fresh: [number, string][],
): FileRow {
  const stat = context.stats.get(result.path) as FileStat;
  return {
    path: result.path,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    content_hash: result.hash,
    parser_version: context.parserVersion,
    language: result.language,
    package: context.packageOf(result.path),
    lines: result.lines,
    has_test: context.tested.has(result.path),
    def_ids: result.definitions.map((definition) => nameId(context, definition.name, fresh)),
    def_kinds: result.definitions.map((definition) => DEFINITION_KINDS.indexOf(definition.kind)),
    def_start_lines: result.definitions.map((definition) => definition.startLine),
    def_end_lines: result.definitions.map((definition) => definition.endLine),
    ref_ids: result.references.map((name) => nameId(context, name, fresh)),
    imports: result.imports,
    endpoints: result.endpoints,
  };
}

async function writeResults(context: Context, results: FileResult[]) {
  const fresh: [number, string][] = [];
  const parsed: FileRow[] = [];
  const unchanged: { path: string; size: number; mtime_ms: number }[] = [];
  for (const result of results) {
    if (result.status === 'parsed') parsed.push(toRow(context, result, fresh));
    if (result.status === 'unchanged') {
      const stat = context.stats.get(result.path) as FileStat;
      unchanged.push({ path: result.path, size: stat.size, mtime_ms: stat.mtimeMs });
    }
  }
  await insertNames(context.db, context.project.id, fresh);
  await upsertFiles(context.db, context.project.id, parsed);
  await touchFiles(context.db, context.project.id, unchanged);
  const missing = results.filter((result) => result.status === 'missing').map((r) => r.path);
  await deleteFiles(context.db, context.project.id, missing);
  return { parsed: parsed.length, unchanged: unchanged.length, missing: missing.length };
}

async function openProject(db: Queryable, root: string, parserVersion: string) {
  const existing = await findIndexProject(db, root);
  if (!existing) {
    return { project: await startIndexProject(db, root, parserVersion), rebuilt: 'first index' };
  }
  const reason = rebuildReason(
    {
      status: existing.status,
      parserVersion: existing.parserVersion,
      fileParserVersions: await fileParserVersions(db, existing.id),
    },
    parserVersion,
  );
  if (!reason) return { project: existing, rebuilt: null };
  return { project: await startIndexProject(db, root, parserVersion), rebuilt: reason };
}

async function gitChanges(root: string, project: IndexProject): Promise<Set<string>> {
  const working = await workingChanges(root);
  const since = project.indexedCommit ? await changedSince(root, project.indexedCommit) : [];
  return new Set([...working, ...(since ?? [])]);
}

function historyIsStale(project: IndexProject, rebuilt: string | null): boolean {
  if (rebuilt || !project.historyAt) return true;
  return Date.now() - project.historyAt.getTime() > HISTORY_MAX_AGE_MS;
}

function relabelled(
  context: Context,
  cached: ReadonlyMap<string, CachedRow>,
  selected: readonly FileStat[],
) {
  return selected.flatMap((file) => {
    const row = cached.get(file.path);
    if (!row) return [];
    const pkg = context.packageOf(file.path);
    const hasTest = context.tested.has(file.path);
    if (row.package === pkg && row.hasTest === hasTest) return [];
    return [{ path: file.path, package: pkg, has_test: hasTest }];
  });
}

export async function indexProject(
  db: Queryable,
  root: string,
  options: IndexOptions = {},
): Promise<IndexOutcome> {
  const started = performance.now();
  const parserVersion = options.parserVersion ?? PARSER_VERSION;
  const { project, rebuilt } = await openProject(db, root, parserVersion);
  const [listed, commit] = await Promise.all([listProjectFiles(root), headCommit(root)]);
  await yieldToEventLoop();
  const stale = historyIsStale(project, rebuilt);
  const [indexable, history, changed] = await Promise.all([
    statIndexable(root, listed),
    stale ? recentHistory(root) : Promise.resolve<Commit[] | null>(null),
    rebuilt ? Promise.resolve(new Set<string>()) : gitChanges(root, project),
  ]);
  const recent = new Set([...changed, ...(history ?? []).flatMap((entry) => entry.files)]);
  const selected = withinCap(indexable, options.fileCap ?? PROJECT_FILE_CAP, recent);
  const read = await readLayout(listed, textReader(root));
  const capped = selected.length < indexable.length;
  await yieldToEventLoop();
  const layout = {
    ...read,
    searchExcludes: capped
      ? uncoveredDirectories(
          indexable.map((file) => file.path),
          new Set(selected.map((file) => file.path)),
        )
      : [],
  };
  const packageOf = packageMatcher(layout.packages);
  const cached = rebuilt ? new Map<string, CachedRow>() : await cachedFiles(db, project.id);
  await yieldToEventLoop();
  const tested = pairTests(
    selected.map((file) => file.path),
    packageOf,
  );
  await yieldToEventLoop();
  const plan = planRefresh(cached, selected, changed);
  const names =
    rebuilt || plan.read.length === 0
      ? new Map<string, number>()
      : await projectNames(db, project.id);
  await yieldToEventLoop();
  const context: Context = {
    db,
    root,
    project,
    parserVersion,
    names,
    nextNameId: largestId(names) + 1,
    stats: new Map(selected.map((file) => [file.path, file])),
    packageOf,
    tested,
  };
  const totals = { parsed: 0, unchanged: 0, missing: 0 };
  for (let start = 0; start < plan.read.length; start += WRITE_BATCH) {
    await options.pace?.(start, plan.read.length);
    const results = await parseFiles(root, plan.read.slice(start, start + WRITE_BATCH));
    const written = await writeResults(context, results);
    totals.parsed += written.parsed;
    totals.unchanged += written.unchanged;
    totals.missing += written.missing;
  }
  await deleteFiles(db, project.id, plan.remove);
  await yieldToEventLoop();
  await relabelFiles(db, project.id, relabelled(context, cached, selected));
  const changedRows = totals.parsed + totals.missing + plan.remove.length > 0;
  if (!rebuilt && changedRows) await pruneNames(db, project.id);
  if (changedRows) await countNameUse(db, project.id);
  await finishIndex(db, project.id, { commit, listedCount: listed.length, layout, history });
  await expireIndexes(db);
  await evictBeyondCap(db, project.id);
  return {
    projectId: project.id,
    rebuilt,
    listed: listed.length,
    indexable: indexable.length,
    capped,
    parsed: totals.parsed,
    unchanged: totals.unchanged,
    removed: plan.remove.length + totals.missing,
    ms: Math.round(performance.now() - started),
  };
}
