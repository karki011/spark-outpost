import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadGuidePages, type GuidePage } from '@spark-outpost/contracts';

const CANDIDATES = [
  path.resolve(import.meta.dirname, '../../../guide'),
  path.resolve(import.meta.dirname, '../../../../../docs/guide'),
];

export function guideDirectory(): string {
  const found = CANDIDATES.find((candidate) => existsSync(path.join(candidate, 'README.md')));
  if (!found) throw new Error('The user guide is not installed with this build of Spark.');
  return found;
}

let cached: Promise<GuidePage[]> | null = null;

async function readGuide(directory: string): Promise<GuidePage[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.md'));
  const files: Record<string, string> = {};
  for (const name of names) files[name] = await readFile(path.join(directory, name), 'utf8');
  return loadGuidePages(files);
}

export function guidePages(): Promise<GuidePage[]> {
  cached ??= readGuide(guideDirectory()).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
