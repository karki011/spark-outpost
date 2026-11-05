import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { ModelStat } from '../../packages/contracts/src/index.ts';
import {
  benchRoundSchema,
  ingestRound,
  statsFromRound,
} from '../../apps/server/src/model-cards/ingest.ts';
import type { Queryable } from '../../apps/server/src/persistence/db.ts';
import { BENCH_CATEGORIES } from './categories.ts';

export const SEED_PATH = 'apps/server/src/model-cards/measured-seed.json';

async function readRound(path: string) {
  return benchRoundSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function ingestFiles(db: Queryable, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const file = relative(process.cwd(), path);
    const result = await ingestRound(db, await readRound(path), file, BENCH_CATEGORIES);
    console.log(`${file}: ${result.stats.length} model stat rows.`);
    for (const skipped of result.skipped) console.log(`  skipped ${skipped}`);
  }
}

export async function writeSeed(paths: readonly string[], method: string): Promise<number> {
  const stats: ModelStat[] = [];
  for (const path of paths) {
    const file = relative(process.cwd(), path);
    stats.push(...statsFromRound(await readRound(path), file, BENCH_CATEGORIES).stats);
  }
  const seed = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    method,
    stats,
  };
  await writeFile(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  return stats.length;
}
