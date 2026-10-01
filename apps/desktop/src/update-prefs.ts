import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateChannel } from '@spark-outpost/contracts';
import { parseChannel } from './update-state.ts';

export interface UpdatePrefs {
  channel: UpdateChannel;
  autoDownload: boolean;
}

const DEFAULTS: UpdatePrefs = { channel: 'stable', autoDownload: true };

export function updatePrefsFile(userData: string): string {
  return path.join(userData, 'updates.json');
}

export async function loadPrefs(file: string): Promise<UpdatePrefs> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return {
      channel: parseChannel(parsed.channel) ?? DEFAULTS.channel,
      autoDownload:
        typeof parsed.autoDownload === 'boolean' ? parsed.autoDownload : DEFAULTS.autoDownload,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function savePrefs(file: string, prefs: UpdatePrefs): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o600 });
}
