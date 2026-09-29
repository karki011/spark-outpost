import { createDb } from '../../apps/server/src/persistence/db.ts';

interface Row {
  engage: boolean;
  reason: string | null;
  placement: string | null;
  row: number | null;
  count: number;
  size: number;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

function percent(part: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((part / total) * 100)}%`;
}

const db = createDb(url);
try {
  const { rows } = await db.query<Row>(
    `SELECT (body->'answer'->>'engage')::boolean AS engage,
       body->'answer'->>'reason' AS reason,
       body->'answer'->>'placement' AS placement,
       (body->'answer'->>'row')::int AS row,
       COUNT(*)::int AS count,
       ROUND(AVG((body->'answer'->>'sizeEstimate')::numeric))::int AS size
     FROM run_advice
     WHERE purpose = 'parallel' AND body->'answer'->>'shadow' = 'true'
     GROUP BY 1, 2, 3, 4 ORDER BY count DESC`,
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const engaged = rows.filter((row) => row.engage).reduce((sum, row) => sum + row.count, 0);
  console.log(
    `Coordinator shadow: ${total} Do builds, ${engaged} would engage (${percent(engaged, total)})`,
  );
  console.log('');
  console.log('engage  reason     placement  row  builds  share  avg size');
  for (const row of rows) {
    console.log(
      [
        String(row.engage).padEnd(6),
        (row.reason ?? '—').padEnd(9),
        (row.placement ?? '—').padEnd(9),
        String(row.row ?? '—').padEnd(3),
        String(row.count).padStart(6),
        percent(row.count, total).padStart(5),
        `${Math.round(row.size / 1000)}K`.padStart(8),
      ].join('  '),
    );
  }
} finally {
  await db.end();
}
