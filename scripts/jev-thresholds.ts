import { createDb } from '../apps/server/src/persistence/db.ts';
import { renderTable, type Sample } from './jev/thresholds.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const BAD_SIGNALS = `EXISTS (SELECT 1 FROM outcome_signals s WHERE s.run_id = r.id
  AND s.kind IN ('reverted', 'correction', 're_ask', 'checks_failed'))`;

const db = createDb(url);
try {
  const policy = await db.query<{ score: number; positive: boolean }>(
    `SELECT (a.body->'answer'->>'max')::float8 AS score,
       (ap.status = 'denied' AND ap.decided_by = 'user') OR r.reverted_at IS NOT NULL
         OR ${BAD_SIGNALS} AS positive
     FROM run_advice a JOIN runs r ON r.id = a.run_id
     LEFT JOIN approvals ap ON ap.id = (a.body->'answer'->'actual'->>'approvalId')::uuid
     WHERE a.purpose = 'policy' AND a.body->'answer'->>'max' IS NOT NULL`,
  );
  const verify = await db.query<{ score: number; positive: boolean }>(
    `SELECT (a.body->'answer'->>'worst')::float8 AS score,
       COALESCE(o.verdict IN ('bad', 'mixed'), false) OR r.reverted_at IS NOT NULL
         OR ${BAD_SIGNALS} AS positive
     FROM run_advice a JOIN runs r ON r.id = a.run_id
     LEFT JOIN task_outcomes o ON o.run_id = r.id
     WHERE a.purpose = 'verify' AND a.body->'answer'->>'worst' IS NOT NULL`,
  );
  const version = await db.query<{ versions: string[] }>(
    `SELECT array_agg(DISTINCT policy_version) AS versions FROM run_advice
     WHERE purpose IN ('policy', 'verify') AND policy_version IS NOT NULL`,
  );
  const toSamples = (rows: { score: number; positive: boolean }[]): Sample[] =>
    rows.map((row) => ({ score: row.score, positive: row.positive === true }));
  console.log(`Policy versions: ${(version.rows[0]?.versions ?? []).join(', ') || 'none'}`);
  console.log(renderTable('Policy gate (max violation)', toSamples(policy.rows)));
  console.log('');
  console.log(renderTable('Verifier (worst unmet)', toSamples(verify.rows)));
} finally {
  await db.end();
}
