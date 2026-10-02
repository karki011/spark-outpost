import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultUpdateChannel, type UpdateChannel } from '@spark-outpost/contracts';
import { parseChannel } from './update-state.ts';

export interface UpdatePrefs {
  channel: UpdateChannel;
  autoDownload: boolean;
}

function defaults(version: string): UpdatePrefs {
  return { channel: defaultUpdateChannel(version), autoDownload: true };
}

export function updatePrefsFile(userData: string): string {
  return path.join(userData, 'updates.json');
}

export async function loadPrefs(file: string, version: string): Promise<UpdatePrefs> {
  const fallback = defaults(version);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return {
      channel: parseChannel(parsed.channel) ?? fallback.channel,
      autoDownload:
        typeof parsed.autoDownload === 'boolean' ? parsed.autoDownload : fallback.autoDownload,
    };
  } catch {
    return fallback;
  }
}

export async function savePrefs(file: string, prefs: UpdatePrefs): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o600 });
}
