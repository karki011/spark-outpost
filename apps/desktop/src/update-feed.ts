import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function updateConfigFile(resourcesPath: string): string {
  return path.join(resourcesPath, 'app-update.yml');
}

export function feedUrlFromConfig(text: string): string | null {
  const match = /^url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text);
  return match?.[1]?.replace(/\/+$/, '') ?? null;
}

export async function readFeedUrl(file: string): Promise<string | null> {
  try {
    return feedUrlFromConfig(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
