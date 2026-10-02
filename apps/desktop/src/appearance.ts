import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isThemeName } from './theme-arg.ts';

export function appearanceFile(userData: string): string {
  return path.join(userData, 'appearance.json');
}

export async function readSavedTheme(file: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { theme?: unknown };
    return isThemeName(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

export async function saveTheme(file: string, theme: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify({ theme }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
}
