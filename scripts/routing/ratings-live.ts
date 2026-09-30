import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Ratings } from '../../packages/contracts/src/index.ts';
import type { IntakeRequest } from '../../apps/server/src/advisor/advice.ts';
import { askJev } from '../../apps/server/src/advisor/intake-recorder.ts';
import { createDb } from '../../apps/server/src/persistence/db.ts';
import { keychainSecretStore } from '../../apps/server/src/setup/secrets.ts';
import { testDatabaseUrl } from '../test-database.ts';
import { replayCandidates, replayCorpus } from './replay-corpus.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'routing-ratings.json' },
    limit: { type: 'string' },
  },
});

const secrets = keychainSecretStore();
if (!(await secrets.get('jev').catch(() => null))) {
  console.error('No Jev key in the keychain.');
  process.exit(1);
}
const db = createDb(testDatabaseUrl());
const deps = {
  db,
  secrets,
  fetch,
  baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
};

const items = replayCorpus().slice(0, values.limit ? Number(values.limit) : undefined);
const ratings: Record<string, Ratings> = {};
let tokens = 0;
let cost = 0;
let previous = '';
try {
  for (const item of items) {
    const request: IntakeRequest = {
      task: item.request,
      mode: 'do',
      reposLinked: true,
      untrusted: [],
      candidates: replayCandidates,
      current: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'medium' },
      level: 'hands-off',
      routing: 'auto',
      firstMessage: !item.followUp,
      currentTask: item.followUp ? { previousRequest: previous, summary: '' } : null,
    };
    previous = item.request;
    const outcome = await askJev(deps, request, 'jev-latest');
    if (outcome.status !== 'answered') {
      console.error(`${item.id}: ${outcome.status} ${'error' in outcome ? outcome.error : ''}`);
      continue;
    }
    tokens += outcome.usage?.inputTokens ?? 0;
    cost += outcome.usage?.costUsd ?? 0;
    ratings[item.id] = outcome.intake.ratings ?? {};
    const shown = Object.entries(outcome.intake.ratings ?? {})
      .flatMap(([key, rating]) =>
        rating ? [`${key} ${rating.value}@${rating.confidence.toFixed(2)}`] : [],
      )
      .join(', ');
    console.log(`${item.id}: ${shown}`);
  }
} finally {
  await db.end();
}
await writeFile(values.out, `${JSON.stringify(ratings, null, 2)}\n`);
console.log(`${Object.keys(ratings).length} rated, ${tokens} input tokens, $${cost.toFixed(4)}`);
