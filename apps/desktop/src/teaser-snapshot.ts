import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  activeRunsSchema,
  API_TOKEN_HEADER,
  bootTeaserSnapshotSchema,
  digestStateSchema,
  teammateListSchema,
  todaySummarySchema,
  type BootTeaserSnapshot,
} from '@spark-outpost/contracts';
import { teaserSnapshot } from './boot-teasers.ts';

const SAVE_EVERY_MS = 3 * 60_000;
const FETCH_TIMEOUT_MS = 4_000;
const QUIT_TIMEOUT_MS = 1_500;

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface SnapshotSource {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export function teaserFile(userData: string): string {
  return path.join(userData, 'boot-teasers.json');
}

async function getJson<T>(
  source: SnapshotSource,
  route: string,
  schema: Parser<T>,
  timeoutMs: number,
): Promise<T | null> {
  try {
    const response = await (source.fetchImpl ?? fetch)(`${source.origin}${route}`, {
      headers: { [API_TOKEN_HEADER]: source.token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fetchTeaserSnapshot(
  source: SnapshotSource,
  now: Date,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<BootTeaserSnapshot | null> {
  const timeZone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [runs, today, digest, teammates] = await Promise.all([
    getJson(source, '/api/runs/active', activeRunsSchema, timeoutMs),
    getJson(source, `/api/home/today?tz=${timeZone}`, todaySummarySchema, timeoutMs),
    getJson(source, '/api/home/digest', digestStateSchema, timeoutMs),
    getJson(source, '/api/teammates', teammateListSchema, timeoutMs),
  ]);
  if (!runs || !today || !digest || !teammates) return null;
  return teaserSnapshot({ activeRuns: runs.activeRuns, today, digest, teammates }, now);
}

export async function readTeaserSnapshot(file: string): Promise<BootTeaserSnapshot | null> {
  try {
    const parsed = bootTeaserSnapshotSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeTeaserSnapshot(
  file: string,
  snapshot: BootTeaserSnapshot,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
}

export interface TeaserSnapshots {
  saveNow(): Promise<void>;
}

export function startTeaserSnapshots(
  source: SnapshotSource,
  file: string,
  log: (line: string) => void,
): TeaserSnapshots {
  let saving = Promise.resolve();
  const save = (timeoutMs: number) => {
    saving = saving
      .then(() => fetchTeaserSnapshot(source, new Date(), timeoutMs))
      .then((snapshot) => (snapshot ? writeTeaserSnapshot(file, snapshot) : undefined))
      .catch((error: Error) => log(`Could not save the boot teasers: ${error.message}`));
    return saving;
  };
  const timer = setInterval(() => void save(FETCH_TIMEOUT_MS), SAVE_EVERY_MS);
  timer.unref();
  return {
    saveNow() {
      clearInterval(timer);
      return save(QUIT_TIMEOUT_MS);
    },
  };
}
