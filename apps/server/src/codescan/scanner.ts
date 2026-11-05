import type { Queryable } from '../persistence/db.ts';
import { indexProject, type IndexOptions, type IndexOutcome } from './indexer.ts';
import { scanRequest, type ScanReport } from './scan.ts';

export const SCAN_DEADLINE_MS = 2500;
export const MAX_CONCURRENT_SCANS = 3;
export const REFRESH_EVERY_MS = 60_000;

export type ScanStatus = 'done' | 'partial' | 'timed_out' | 'queued_past_deadline' | 'failed';

export interface ScanOutcome {
  status: ScanStatus;
  report: ScanReport | null;
  error: string | null;
  elapsedMs: number;
  queuedMs: number;
}

export interface CodeScanner {
  scan(root: string, request: string, startedAt?: number): Promise<ScanOutcome>;
  ensureIndexed(root: string, request?: IndexRequest): Promise<IndexOutcome | null>;
  idle(): Promise<void>;
}

export interface IndexRequest {
  fresh?: boolean;
  pace?: IndexOptions['pace'];
}

export interface ScannerOptions {
  deadlineMs?: number;
  maxConcurrent?: number;
  refreshEveryMs?: number;
  scanIndexPace?: (() => NonNullable<IndexOptions['pace']>) | undefined;
}

export interface Limiter {
  acquire(signal: AbortSignal): Promise<boolean>;
  release(): void;
}

export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    acquire(signal) {
      if (active < max) {
        active += 1;
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const grant = () => {
          signal.removeEventListener('abort', giveUp);
          active += 1;
          resolve(true);
        };
        const giveUp = () => {
          waiting.splice(waiting.indexOf(grant), 1);
          resolve(false);
        };
        waiting.push(grant);
        signal.addEventListener('abort', giveUp, { once: true });
      });
    },
    release() {
      active -= 1;
      waiting.shift()?.();
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCodeScanner(db: Queryable, options: ScannerOptions = {}): CodeScanner {
  const deadlineMs = options.deadlineMs ?? SCAN_DEADLINE_MS;
  const refreshEveryMs = options.refreshEveryMs ?? REFRESH_EVERY_MS;
  const limiter = createLimiter(options.maxConcurrent ?? MAX_CONCURRENT_SCANS);
  const indexing = new Map<string, Promise<IndexOutcome | null>>();
  const lastIndexed = new Map<string, number>();
  let lane: Promise<unknown> = Promise.resolve();

  function ensureIndexed(root: string, request: IndexRequest = {}): Promise<IndexOutcome | null> {
    const running = indexing.get(root);
    if (running) return running;
    const recent = Date.now() - (lastIndexed.get(root) ?? 0) < refreshEveryMs;
    if (recent && !request.fresh) return Promise.resolve(null);
    const work = lane
      .then(() => indexProject(db, root, request.pace ? { pace: request.pace } : {}))
      .catch((error: unknown) => {
        console.error(`Could not index ${root}`, error);
        return null;
      })
      .finally(() => {
        indexing.delete(root);
        lastIndexed.set(root, Date.now());
      });
    lane = work;
    indexing.set(root, work);
    return work;
  }

  async function scan(
    root: string,
    request: string,
    startedAt: number = Date.now(),
  ): Promise<ScanOutcome> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    void ensureIndexed(root, { pace: options.scanIndexPace?.() });
    const deadline = AbortSignal.timeout(Math.max(0, startedAt + deadlineMs - Date.now()));
    if (!(await limiter.acquire(deadline))) {
      return {
        status: 'queued_past_deadline',
        report: null,
        error: null,
        elapsedMs: elapsed(),
        queuedMs: elapsed(),
      };
    }
    const queuedMs = elapsed();
    try {
      const report = await scanRequest(db, root, request, deadline);
      const status: ScanStatus = !report ? 'timed_out' : report.partial ? 'partial' : 'done';
      return { status, report, error: null, elapsedMs: elapsed(), queuedMs };
    } catch (error) {
      return {
        status: 'failed',
        report: null,
        error: message(error),
        elapsedMs: elapsed(),
        queuedMs,
      };
    } finally {
      limiter.release();
    }
  }

  return {
    scan,
    ensureIndexed,
    async idle() {
      while (indexing.size > 0) await Promise.all([...indexing.values()]);
    },
  };
}
