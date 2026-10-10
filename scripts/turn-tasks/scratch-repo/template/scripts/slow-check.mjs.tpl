import { readFile } from 'node:fs/promises';
import { record, secondsFlag, sleep } from './run-state.mjs';

const STEP_SECONDS = 10;
const seconds = secondsFlag(900);
const startedAt = new Date().toISOString();

function problemsIn(items) {
  const problems = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.sku)) problems.push(`duplicate sku ${item.sku} (${item.name})`);
    seen.add(item.sku);
    if (!Number.isInteger(item.priceCents) || item.priceCents <= 0) {
      problems.push(`bad price ${item.priceCents} for ${item.sku} (${item.name})`);
    }
  }
  return problems;
}

for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
  console.log(`checking the catalog: ${elapsed} of ${seconds} seconds`);
  await sleep(Math.min(STEP_SECONDS, seconds - elapsed) * 1000);
}

const items = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const problems = problemsIn(items);
const finishedAt = new Date().toISOString();
await record('slow-check.json', { seconds, startedAt, finishedAt, problems: problems.length });

if (problems.length > 0) {
  console.log(`slow check failed after ${seconds} seconds: ${problems.length} problems in data/catalog.json`);
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
console.log(`slow check passed after ${seconds} seconds`);
