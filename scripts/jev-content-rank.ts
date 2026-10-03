import { parseArgs } from 'node:util';
import { createDb } from '../apps/server/src/persistence/db.ts';
import { routingLabels } from '../apps/server/src/persistence/routing-labels.ts';
import { toLabel } from '../apps/server/src/routing/labels.ts';
import { comparable, renderContentRank, summarise } from './jev/content-rank.ts';

const { values } = parseArgs({
  options: { since: { type: 'string' }, 'search-path': { type: 'string' } },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url, values['search-path'] ? { searchPath: values['search-path'] } : {});
try {
  const rows = await routingLabels(db, values.since ? { since: new Date(values.since) } : {});
  console.log(renderContentRank(summarise(comparable(rows.map(toLabel)))));
} finally {
  await db.end();
}
