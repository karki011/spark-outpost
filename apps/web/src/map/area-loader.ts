import type { MapAreaDetail } from '@spark-outpost/contracts';
import { loadRequests, type LoadCandidate, type LoadRequest } from './lod.ts';

const CONCURRENCY = 4;
const FLUSH_MS = 60;
const QUEUED = 64;

export interface LoadedArea {
  detail: MapAreaDetail;
  version: string;
}

type Fetch = (key: string, limit: number) => Promise<MapAreaDetail>;
type Deliver = (batch: ReadonlyMap<string, LoadedArea>) => void;

function projectOf(key: string): string {
  return key.slice(0, key.indexOf(':'));
}

export class AreaLoader {
  private readonly loaded = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private queue: LoadRequest[] = [];
  private urgent: LoadRequest[] = [];
  private pending = new Map<string, LoadedArea>();
  private versions = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly fetch: Fetch,
    private readonly deliver: Deliver,
  ) {}

  want(candidates: readonly LoadCandidate[]): void {
    const known = candidates.map((candidate) => ({
      ...candidate,
      loaded: Math.max(candidate.loaded, this.loaded.get(candidate.key) ?? 0),
    }));
    this.queue = loadRequests(known, this.inFlight, QUEUED);
    this.pump();
  }

  require(keys: readonly string[]): void {
    const missing = keys.filter((key) => (this.loaded.get(key) ?? 0) < Infinity);
    if (missing.length === 0) return;
    this.urgent = [
      ...missing.map((key) => ({ key, limit: Infinity })),
      ...this.urgent.filter((request) => !missing.includes(request.key)),
    ];
    this.pump();
  }

  sync(versions: ReadonlyMap<string, string>): void {
    for (const [project, version] of versions) {
      const previous = this.versions.get(project);
      this.versions.set(project, version);
      if (previous === undefined || previous === version) continue;
      for (const key of [...this.loaded.keys()]) {
        if (projectOf(key) === project) this.loaded.delete(key);
      }
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    this.queue = [];
    this.urgent = [];
  }

  private pump(): void {
    while (this.inFlight.size < CONCURRENCY) {
      const request = this.urgent.shift() ?? this.queue.shift();
      if (!request) return;
      if ((this.loaded.get(request.key) ?? 0) >= request.limit) continue;
      this.inFlight.add(request.key);
      const version = this.versions.get(projectOf(request.key)) ?? '';
      this.fetch(request.key, request.limit)
        .then((detail) => {
          this.loaded.set(request.key, detail.nextOffset === null ? Infinity : request.limit);
          this.pending.set(request.key, { detail, version });
          this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
        })
        .catch(() => this.loaded.set(request.key, request.limit))
        .finally(() => {
          this.inFlight.delete(request.key);
          this.pump();
        });
    }
  }

  private flush(): void {
    this.timer = undefined;
    const batch = this.pending;
    this.pending = new Map();
    this.deliver(batch);
  }
}
