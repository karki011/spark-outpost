import { createHash, randomUUID } from 'node:crypto';
import type {
  ChangeEntry,
  ChangeFolder,
  ChangePage,
  ChangeRunSummary,
  ChangedFile,
} from '@spark-outpost/contracts';
import type { FileContents, ListedFile } from './change-list.ts';
import { netTotals, type EntryContents } from './change-totals.ts';
import type { ListedRun } from './task-changes.ts';

const MAX_SETS = 8;
const SET_TTL_MS = 10 * 60_000;
const CONTENT_BUDGET_BYTES = 64 * 1024 * 1024;
const TOP_FILES = 5;

export interface SetEntry {
  runId: string;
  root: string;
  listed: ListedFile;
}

export interface ChangeSet {
  version: string;
  taskId: string;
  createdAt: number;
  runs: readonly ListedRun[];
  entries: readonly SetEntry[];
}

function byPath(a: SetEntry, b: SetEntry): number {
  const left = a.listed.file.path;
  const right = b.listed.file.path;
  return left < right ? -1 : left > right ? 1 : 0;
}

function contentVersion(taskId: string, runs: readonly ListedRun[]): string {
  const files = runs.flatMap((run) => run.files);
  if (files.some((listed) => listed.revision === undefined)) return randomUUID();
  const hash = createHash('sha1').update(taskId);
  for (const run of runs) {
    hash.update(
      `\0run\0${run.runId}\0${run.revertedAt ?? ''}\0${run.name ?? ''}\0${run.copy ?? ''}`,
    );
    for (const { file, revision } of run.files) {
      hash.update(`\0${file.path}\0${file.oldPath ?? ''}\0${file.change}\0${revision}`);
    }
    for (const reverted of run.reverted ?? []) {
      hash.update(`\0reverted\0${reverted.path}\0${reverted.revertedAt}`);
    }
  }
  return hash.digest('hex');
}

export function buildChangeSet(
  taskId: string,
  runs: readonly ListedRun[],
  now: number,
  version: string = contentVersion(taskId, runs),
): ChangeSet {
  const entries = runs
    .filter((run) => !run.revertedAt)
    .flatMap((run) => run.files.map((listed) => ({ runId: run.runId, root: run.root, listed })))
    .sort(byPath);
  return { version, taskId, createdAt: now, runs, entries };
}

export function toEntry({ runId, listed }: SetEntry): ChangeEntry {
  const { path, change, oldPath, added, removed, shown, truncated, bytes } = listed.file;
  return {
    runId,
    path,
    change,
    ...(oldPath === undefined ? {} : { oldPath }),
    added,
    removed,
    shown,
    ...(truncated === undefined ? {} : { truncated }),
    ...(bytes === undefined ? {} : { bytes }),
  };
}

function churn(file: ChangedFile): number {
  return (file.added ?? 0) + (file.removed ?? 0);
}

function sums(files: readonly ChangedFile[]): { files: number; added: number; removed: number } {
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
  };
}

export async function summarize(set: ChangeSet, contents: EntryContents) {
  const runs: ChangeRunSummary[] = set.runs.map((run) => ({
    runId: run.runId,
    revertedAt: run.revertedAt,
    ...(run.name ? { name: run.name } : {}),
    ...(run.copy ? { copy: run.copy } : {}),
    ...sums(run.files.map((listed) => listed.file)),
    reverted: run.reverted ?? [],
  }));
  const top = [...set.entries]
    .sort((a, b) => churn(b.listed.file) - churn(a.listed.file))
    .slice(0, TOP_FILES)
    .map(toEntry);
  return {
    version: set.version,
    ...(await netTotals(set.entries, contents)),
    runs,
    top,
  };
}

function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function foldersOf(entries: readonly SetEntry[]): ChangeFolder[] {
  const folders: ChangeFolder[] = [];
  entries.forEach((entry, index) => {
    const folder = folderOf(entry.listed.file.path);
    const last = folders.at(-1);
    if (last?.path === folder) last.count++;
    else folders.push({ path: folder, start: index, count: 1 });
  });
  return folders;
}

export interface PageRequest {
  offset: number;
  limit: number;
  q?: string | undefined;
  runs?: readonly string[] | undefined;
}

function matches(entry: SetEntry, request: PageRequest): boolean {
  if (request.runs && !request.runs.includes(entry.runId)) return false;
  if (!request.q) return true;
  const needle = request.q.toLowerCase();
  const { path, oldPath } = entry.listed.file;
  return path.toLowerCase().includes(needle) || Boolean(oldPath?.toLowerCase().includes(needle));
}

export function changePage(set: ChangeSet, request: PageRequest): ChangePage {
  const filtered =
    request.q || request.runs
      ? set.entries.filter((entry) => matches(entry, request))
      : set.entries;
  return {
    version: set.version,
    total: filtered.length,
    offset: request.offset,
    files: filtered.slice(request.offset, request.offset + request.limit).map(toEntry),
    folders: foldersOf(filtered),
  };
}

export function findEntry(set: ChangeSet, runId: string, path: string): SetEntry | null {
  return (
    set.entries.find((entry) => entry.runId === runId && entry.listed.file.path === path) ?? null
  );
}

interface Loading {
  running: Promise<ChangeSet>;
  queued: Promise<ChangeSet> | null;
}

const settled = () => undefined;

export class ChangeSetCache {
  private readonly sets = new Map<string, ChangeSet>();
  private readonly loads = new Map<string, Loading>();
  private readonly contents = new Map<string, Promise<FileContents>>();
  private readonly sizes = new Map<string, number>();
  private contentBytes = 0;

  constructor(
    private readonly load: (taskId: string) => Promise<ListedRun[]>,
    private readonly now: () => number = Date.now,
  ) {}

  fresh(taskId: string): Promise<ChangeSet> {
    const loading = this.loads.get(taskId);
    if (!loading) return this.start(taskId);
    loading.queued ??= loading.running.then(settled, settled).then(() => this.start(taskId));
    return loading.queued;
  }

  private start(taskId: string): Promise<ChangeSet> {
    const running = this.build(taskId);
    this.loads.set(taskId, { running, queued: null });
    void running.then(settled, settled).then(() => {
      if (this.loads.get(taskId)?.running === running) this.loads.delete(taskId);
    });
    return running;
  }

  private async build(taskId: string): Promise<ChangeSet> {
    const set = buildChangeSet(taskId, await this.load(taskId), this.now());
    this.sets.set(set.version, set);
    this.prune();
    return set;
  }

  async get(taskId: string, version: string | undefined): Promise<ChangeSet> {
    const cached = version ? this.sets.get(version) : undefined;
    if (cached?.taskId === taskId && this.now() - cached.createdAt < SET_TTL_MS) return cached;
    return this.fresh(taskId);
  }

  fileContents(set: ChangeSet, entry: SetEntry): Promise<FileContents> {
    const key = `${set.version}:${entry.runId}:${entry.listed.file.path}`;
    const cached = this.contents.get(key);
    if (cached) {
      this.contents.delete(key);
      this.contents.set(key, cached);
      return cached;
    }
    const loading = entry.listed.contents();
    this.contents.set(key, loading);
    loading.then(
      (loaded) => this.track(key, (loaded.before?.length ?? 0) + (loaded.after?.length ?? 0)),
      () => this.contents.delete(key),
    );
    return loading;
  }

  private track(key: string, bytes: number): void {
    if (!this.contents.has(key)) return;
    this.sizes.set(key, bytes);
    this.contentBytes += bytes;
    for (const oldest of this.contents.keys()) {
      if (this.contentBytes <= CONTENT_BUDGET_BYTES || oldest === key) break;
      this.contents.delete(oldest);
      this.contentBytes -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
    }
  }

  private prune(): void {
    const expired = this.now() - SET_TTL_MS;
    for (const [version, set] of this.sets) {
      if (this.sets.size > MAX_SETS || set.createdAt < expired) this.sets.delete(version);
    }
  }
}
