import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDb } from '../../apps/server/src/persistence/db.ts';
import { routingLabels } from '../../apps/server/src/persistence/routing-labels.ts';
import { toLabel } from '../../apps/server/src/routing/labels.ts';

const { values } = parseArgs({
  options: {
    since: { type: 'string' },
    out: { type: 'string' },
    'search-path': { type: 'string' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url, values['search-path'] ? { searchPath: values['search-path'] } : {});
try {
  const rows = await routingLabels(db, values.since ? { since: new Date(values.since) } : {});
  const json = `${JSON.stringify(rows.map(toLabel), null, 2)}\n`;
  if (values.out) {
    await writeFile(values.out, json);
    console.error(`Wrote ${rows.length} labels to ${values.out}`);
  } else {
    process.stdout.write(json);
  }
} finally {
  await db.end();
}
