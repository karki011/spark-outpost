import { randomUUID } from 'node:crypto';
import type {
  ChangeEntry,
  ChangeFolder,
  ChangePage,
  ChangeRunSummary,
  ChangedFile,
} from '@spark-outpost/contracts';
import type { FileContents, ListedFile } from './change-list.ts';
import type { ListedRun } from './task-changes.ts';

const MAX_SETS = 8;
const SET_TTL_MS = 10 * 60_000;
const CONTENT_BUDGET_BYTES = 64 * 1024 * 1024;
const TOP_FILES = 5;

export interface SetEntry {
  runId: string;
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

export function buildChangeSet(
  taskId: string,
  runs: readonly ListedRun[],
  now: number,
  version: string = randomUUID(),
): ChangeSet {
  const entries = runs
    .filter((run) => !run.revertedAt)
    .flatMap((run) => run.files.map((listed) => ({ runId: run.runId, listed })))
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

export function summarize(set: ChangeSet) {
  const runs: ChangeRunSummary[] = set.runs.map((run) => ({
    runId: run.runId,
    revertedAt: run.revertedAt,
    ...(run.name ? { name: run.name } : {}),
    ...(run.copy ? { copy: run.copy } : {}),
    ...sums(run.files.map((listed) => listed.file)),
  }));
  const top = [...set.entries]
    .sort((a, b) => churn(b.listed.file) - churn(a.listed.file))
    .slice(0, TOP_FILES)
    .map(toEntry);
  return {
    version: set.version,
    ...sums(set.entries.map((entry) => entry.listed.file)),
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

export class ChangeSetCache {
  private readonly sets = new Map<string, ChangeSet>();
  private readonly contents = new Map<string, Promise<FileContents>>();
  private readonly sizes = new Map<string, number>();
  private contentBytes = 0;

  constructor(
    private readonly load: (taskId: string) => Promise<ListedRun[]>,
    private readonly now: () => number = Date.now,
  ) {}

  async fresh(taskId: string): Promise<ChangeSet> {
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
