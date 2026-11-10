import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'live-reuse-bench-'));
const report = join(dir, 'report.txt');

const run = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--project', 'db', 'apps/server/test/live-reuse.db.test.ts'],
  { stdio: 'inherit', env: { ...process.env, SPARK_REUSE_REPORT: report } },
);

try {
  console.log(readFileSync(report, 'utf8'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(run.status ?? 1);
