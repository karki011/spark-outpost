import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type BakedManifest = Record<string, unknown>;

export async function readBakedManifest(appPath: string): Promise<BakedManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as BakedManifest) : null;
  } catch {
    return null;
  }
}
