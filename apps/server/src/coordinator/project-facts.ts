import { open } from 'node:fs/promises';
import path from 'node:path';
import type { AgentPick } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import { mapLimit } from '../codescan/file-stats.ts';
import { git } from '../projects/snapshot.ts';
import { builderBudget, type LineCount } from './size.ts';

const MAX_COUNTED_FILES = 400;
const MAX_COUNTED_BYTES = 1_000_000;
const COUNT_CONCURRENCY = 16;

export async function projectFiles(root: string): Promise<string[]> {
  const output = await git(root, ['ls-files', '-co', '--exclude-standard']).catch(() => '');
  return output.split('\n').filter(Boolean);
}

async function countLines(file: string): Promise<number | null> {
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    if (size > MAX_COUNTED_BYTES) return Math.round(size / 40);
    const text = await handle.readFile('utf8');
    return text.length === 0 ? 0 : text.split('\n').length;
  } finally {
    await handle.close();
  }
}

export async function lineCounter(
  root: string,
  paths: readonly string[],
  known: ReadonlyMap<string, number> = new Map(),
): Promise<LineCount> {
  const counts = new Map(known);
  const missing = [...new Set(paths)]
    .filter((file) => !counts.has(file))
    .slice(0, MAX_COUNTED_FILES);
  const found = await mapLimit(missing, COUNT_CONCURRENCY, (file) =>
    countLines(path.join(root, file)),
  );
  missing.forEach((file, index) => {
    const lines = found[index];
    if (lines !== null && lines !== undefined) counts.set(file, lines);
  });
  return (file) => counts.get(file) ?? null;
}

export function budgetFor(pick: Pick<AgentPick, 'provider' | 'model' | 'modelLabel'>): number {
  if (!pick.model) return builderBudget(null);
  const card = cardFor({ id: pick.model, label: pick.modelLabel }, pick.provider);
  return builderBudget(card?.contextTokens ?? null);
}
