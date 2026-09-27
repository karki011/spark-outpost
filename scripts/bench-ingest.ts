import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDb } from '../apps/server/src/persistence/db.ts';
import { ingestFiles, SEED_PATH, writeSeed } from './bench/ingest-files.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'write-seed': { type: 'boolean', default: false } },
});

if (positionals.length === 0) {
  console.error('Usage: pnpm bench:ingest [--write-seed] <round.json…>');
  process.exit(1);
}

if (values['write-seed']) {
  const current = JSON.parse(await readFile(SEED_PATH, 'utf8')) as { method: string };
  const count = await writeSeed(positionals, current.method);
  console.log(`Wrote ${count} rows to ${SEED_PATH}.`);
} else {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = createDb(url);
  try {
    await ingestFiles(db, positionals);
  } finally {
    await db.end();
  }
}
