import { z } from 'zod';
import {
  reportedPullStateSchema,
  ticketBranchSchema,
  ticketBuildsSchema,
  ticketCommitsSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  saveDevelopment,
  storedDevelopment,
  type StoredDevelopment,
} from '../persistence/ticket-development.ts';
import type { OpenSource } from './connections.ts';
import type { SourceDevelopment } from './source.ts';

export const DEVELOPMENT_TTL_MS = 10 * 60_000;
export const UNAVAILABLE_TTL_MS = 5 * 60_000;
export const REFRESH_BUDGET = 25;
const CONCURRENCY = 4;
const FAILURE_LIMIT = 3;

export type DevelopmentRead = SourceDevelopment | 'unavailable';

const storedSchema: z.ZodType<SourceDevelopment> = z.object({
  pullRequests: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable(),
      state: reportedPullStateSchema,
      branch: z.string().nullable(),
      author: z.string().nullable(),
      updatedAt: z.string().nullable(),
      repo: z.string().nullable(),
      number: z.number().int().positive().nullable(),
    }),
  ),
  branches: z.array(ticketBranchSchema),
  commits: ticketCommitsSchema.nullable(),
  builds: ticketBuildsSchema.nullable(),
});

interface CacheDeps {
  db: Db;
  workspaceId: string;
}

function readOf(row: StoredDevelopment): DevelopmentRead | null {
  if (row.outcome === 'unavailable') return 'unavailable';
  const parsed = storedSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

function isFresh(row: StoredDevelopment, maxAgeMs: number, now: Date): boolean {
  const limit = row.outcome === 'ok' ? maxAgeMs : UNAVAILABLE_TTL_MS;
  return readOf(row) !== null && now.getTime() - row.fetchedAt.getTime() < limit;
}

async function refresh(
  deps: CacheDeps,
  open: OpenSource,
  keys: readonly string[],
  now: Date,
): Promise<Map<string, DevelopmentRead>> {
  const read = new Map<string, DevelopmentRead>();
  const queue = [...keys];
  let failures = 0;
  async function worker() {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      let result: DevelopmentRead = 'unavailable';
      if (failures < FAILURE_LIMIT) {
        try {
          result = await open.source.development!(key);
        } catch {
          failures += 1;
        }
      }
      read.set(key, result);
      await saveDevelopment(
        deps.db,
        deps.workspaceId,
        open.connection.source,
        key,
        result === 'unavailable' ? null : result,
        now,
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return read;
}

export async function sourceDevelopment(
  deps: CacheDeps,
  open: OpenSource,
  keys: readonly string[],
  now: Date,
  maxAgeMs = DEVELOPMENT_TTL_MS,
): Promise<Map<string, DevelopmentRead>> {
  if (!open.source.development || keys.length === 0) return new Map();
  const stored = await storedDevelopment(deps.db, deps.workspaceId, open.connection.source, keys);
  const stale = keys
    .filter((key) => {
      const row = stored.get(key);
      return !row || !isFresh(row, maxAgeMs, now);
    })
    .toSorted(
      (a, b) =>
        (stored.get(a)?.fetchedAt.getTime() ?? 0) - (stored.get(b)?.fetchedAt.getTime() ?? 0),
    )
    .slice(0, REFRESH_BUDGET);
  const fetched = await refresh(deps, open, stale, now);
  const result = new Map<string, DevelopmentRead>();
  for (const key of keys) {
    const row = stored.get(key);
    const known = fetched.get(key) ?? (row ? readOf(row) : null);
    if (known) result.set(key, known);
  }
  return result;
}
