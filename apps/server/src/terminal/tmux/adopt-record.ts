import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const FILE = 'adopt.json';
const OBSERVER = 'observer.json';

const recordSchema = z.object({
  grant: z.string().regex(/^[0-9a-f]{64}$/),
  mcpPort: z.number().int().min(1).max(65_535),
  ceiling: z.string().min(1).max(100),
});

export type AdoptRecord = z.infer<typeof recordSchema>;

export interface StoredLaunch {
  directory: string;
  record: AdoptRecord;
  observed: boolean;
}

export function sessionRoot(dataDir: string, channel: string, sessionId: string): string {
  return join(dataDir, channel, 'terminal-sessions', sessionId);
}

export async function writeAdoptRecord(directory: string, record: AdoptRecord): Promise<void> {
  await writeFile(join(directory, FILE), JSON.stringify(recordSchema.parse(record)), {
    mode: 0o600,
  });
}

async function readRecord(directory: string): Promise<{ record: AdoptRecord; at: number } | null> {
  try {
    const path = join(directory, FILE);
    const record = recordSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return record.success ? { record: record.data, at: (await stat(path)).mtimeMs } : null;
  } catch {
    return null;
  }
}

export async function readStoredLaunch(root: string): Promise<StoredLaunch | null> {
  const names = await readdir(root).catch(() => [] as string[]);
  let newest: (StoredLaunch & { at: number }) | null = null;
  for (const name of names) {
    const directory = join(root, name);
    const found = await readRecord(directory);
    if (!found || (newest && found.at <= newest.at)) continue;
    const observed = await stat(join(directory, OBSERVER)).then(
      () => true,
      () => false,
    );
    newest = { directory, record: found.record, observed, at: found.at };
  }
  return (
    newest && { directory: newest.directory, record: newest.record, observed: newest.observed }
  );
}

export async function writeObserver(
  directory: string,
  observer: {
    url: string;
    token: string;
    sessionId: string;
    provider: string;
    permissionUrl?: string;
    record?: boolean;
  },
): Promise<void> {
  await writeFile(join(directory, OBSERVER), JSON.stringify(observer), { mode: 0o600 });
}
