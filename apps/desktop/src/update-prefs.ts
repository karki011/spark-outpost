import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateChannel } from '@spark-outpost/contracts';
import { parseChannel } from './update-state.ts';

export function updatePrefsFile(userData: string): string {
  return path.join(userData, 'updates.json');
}

export async function loadChannel(file: string): Promise<UpdateChannel> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { channel?: unknown };
    return parseChannel(parsed.channel) ?? 'stable';
  } catch {
    return 'stable';
  }
}

export async function saveChannel(file: string, channel: UpdateChannel): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ channel }, null, 2)}\n`, { mode: 0o600 });
}
