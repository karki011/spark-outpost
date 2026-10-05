import { createHash } from 'node:crypto';
import type { Queryable } from './db.ts';

export interface BaselineKey {
  repo: string;
  baseTree: string;
  cwd: string;
  command: string;
}

export interface BaselineRecord {
  exitCode: number | null;
  timedOut: boolean;
  failures: string[];
  shape: string;
  durationMs: number;
}

interface Row {
  exit_code: number | null;
  timed_out: boolean;
  failures: string[];
  output_shape: string;
  duration_ms: number;
}

const KEPT_DAYS = 30;

function hashOf(command: string): string {
  return createHash('sha256').update(command).digest('hex');
}

export async function savedBaseline(
  db: Queryable,
  key: BaselineKey,
): Promise<BaselineRecord | null> {
  const { rows } = await db.query<Row>(
    `SELECT exit_code, timed_out, failures, output_shape, duration_ms FROM check_baselines
     WHERE repo = $1 AND base_tree = $2 AND cwd = $3 AND command_hash = $4`,
    [key.repo, key.baseTree, key.cwd, hashOf(key.command)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    exitCode: row.exit_code,
    timedOut: row.timed_out,
    failures: row.failures,
    shape: row.output_shape,
    durationMs: row.duration_ms,
  };
}

export async function saveBaseline(
  db: Queryable,
  key: BaselineKey,
  record: BaselineRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO check_baselines
       (repo, base_tree, cwd, command_hash, command, exit_code, timed_out, failures, output_shape,
        duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (repo, base_tree, cwd, command_hash) DO NOTHING`,
    [
      key.repo,
      key.baseTree,
      key.cwd,
      hashOf(key.command),
      key.command.slice(0, 2000),
      record.exitCode,
      record.timedOut,
      record.failures,
      record.shape,
      record.durationMs,
    ],
  );
  await db.query(
    `DELETE FROM check_baselines WHERE created_at < now() - make_interval(days => $1)`,
    [KEPT_DAYS],
  );
}
