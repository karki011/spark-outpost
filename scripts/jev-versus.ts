import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keychainSecretStore } from '../apps/server/src/setup/secrets.ts';
import { capture } from './jev/versus-capture.ts';
import { evidenceItems, fixtureItems, type Item } from './jev/versus-items.ts';
import {
  JEV,
  qualityTable,
  ratingTable,
  readings,
  reliabilityTable,
  rethresholdTable,
} from './jev/versus-report.ts';
import { datasetTable, failureTable, latencyTable, rankTable } from './jev/versus-usage.ts';
import { readRows, runHaiku, runJev, type HaikuVariant } from './jev/versus-run.ts';

const HAIKU_VARIANTS: readonly HaikuVariant[] = [
  { name: 'haiku-batch-low', mode: 'batch', effort: 'low' },
  { name: 'haiku-single-low', mode: 'single', effort: 'low' },
  { name: 'haiku-batch-medium', mode: 'batch', effort: 'medium' },
  { name: 'haiku-merged8-low', mode: 'batch', effort: 'low', merge: 8 },
];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'jev-versus' },
    evidence: { type: 'string' },
    root: { type: 'string', default: '.' },
    corpus: { type: 'string', default: '30' },
    rank: { type: 'string', default: '30' },
    budget: { type: 'string', default: '0.3' },
    variant: { type: 'string', default: JEV },
    uses: { type: 'string' },
    every: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string', default: '5' },
  },
});

const out = resolve(values.out);
mkdirSync(join(out, 'cwd'), { recursive: true });
const itemsFile = join(out, 'items.jsonl');
const resultsFile = join(out, 'results.jsonl');

function loadItems(): Item[] {
  if (!existsSync(itemsFile)) return [];
  return readFileSync(itemsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Item);
}

function addItems(items: readonly Item[]): number {
  const known = new Set(loadItems().map((item) => item.id));
  const fresh = items.filter((item) => !known.has(item.id) && known.add(item.id));
  for (const item of fresh) appendFileSync(itemsFile, `${JSON.stringify(item)}\n`);
  return fresh.length;
}

function selected(): Item[] {
  const uses = values.uses ? new Set(values.uses.split(',')) : null;
  const every = Number(values.every);
  const counts = new Map<string, number>();
  return loadItems().filter((item) => {
    if (uses && !uses.has(item.use)) return false;
    const seen = counts.get(item.use) ?? 0;
    counts.set(item.use, seen + 1);
    return seen % every === 0;
  });
}

async function ask(): Promise<void> {
  const options = {
    out: resultsFile,
    concurrency: Number(values.concurrency),
    spendLimitUsd: Number(values.limit),
  };
  if (values.variant === JEV) {
    const apiKey = await keychainSecretStore()
      .get('jev')
      .catch(() => null);
    if (!apiKey) throw new Error('No Jev key in the keychain.');
    console.log(JSON.stringify(await runJev(selected(), apiKey, options)));
    return;
  }
  const variant = HAIKU_VARIANTS.find((entry) => entry.name === values.variant);
  if (!variant) throw new Error(`Unknown variant ${values.variant}.`);
  console.log(JSON.stringify(await runHaiku(selected(), variant, join(out, 'cwd'), options)));
}

function report(): string {
  const items = loadItems();
  const rows = readRows(resultsFile);
  const variants = [JEV, ...HAIKU_VARIANTS.map((variant) => variant.name)].filter((name) =>
    rows.some((row) => row.variant === name),
  );
  const all = readings(items, rows);
  return [
    '## Dataset',
    datasetTable(items),
    '## Answers per question',
    qualityTable(all, variants),
    '## Ratings: Haiku level against Jev level',
    ratingTable(all, variants),
    '## Stated probability against outcomes',
    reliabilityTable(all, variants),
    "## The line Haiku would need to match Jev's precision",
    rethresholdTable(all, variants),
    '## File ranking',
    rankTable(all, variants),
    '## Latency, tokens and cost per call',
    latencyTable(items, rows, variants),
    '## Failures',
    failureTable(rows, all, variants),
  ].join('\n\n');
}

const command = positionals[0];
if (command === 'items') {
  const fixtures = await fixtureItems(Number(values.corpus));
  const evidence = values.evidence ? evidenceItems(resolve(values.evidence)) : [];
  console.log(`${addItems([...fixtures, ...evidence])} items added to ${itemsFile}`);
} else if (command === 'capture') {
  if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
  const captured = await capture(resolve(values.root), Number(values.rank), Number(values.budget));
  const added = addItems(captured.items);
  const known = new Set(readRows(resultsFile).map((row) => `${row.item}|${row.variant}`));
  for (const row of captured.jevRows) {
    if (known.has(`${row.item}|${row.variant}`)) continue;
    known.add(`${row.item}|${row.variant}`);
    appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
  }
  writeFileSync(join(out, 'map-build.json'), JSON.stringify(captured.mapTimings, null, 2));
  console.log(`${added} items captured; ${captured.jevRows.length} Jev map calls recorded`);
} else if (command === 'ask') {
  await ask();
} else if (command === 'report') {
  const text = report();
  writeFileSync(join(out, 'report.md'), `${text}\n`);
  console.log(text);
} else {
  console.error('Use: jev-versus <items|capture|ask|report> --out <dir>');
  process.exit(1);
}
