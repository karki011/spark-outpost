import { setImmediate as nextTurn } from 'node:timers/promises';
import type {
  AuditLogPage,
  AuditLogQuery,
  ChainVerification,
  ProtocolLogEntry,
} from '@spark-outpost/contracts';
import { CHAIN_START, chainRows, verifyChain, type HashedRow } from '../audit/hash-chain.ts';
import type { ProtocolEntry } from '../audit/protocol-entry.ts';
import { withTransaction, type Db, type DbClient, type Queryable } from './db.ts';
import type { Lease } from './jobs.ts';
import { containsPattern } from './like-pattern.ts';
import { assertLeaseHeld } from './run-events.ts';

interface LogRow {
  run_id: string;
  seq: number;
  at: Date;
  direction: ProtocolLogEntry['direction'];
  kind: ProtocolLogEntry['kind'];
  method: string | null;
  rpc_id: string | null;
  size_bytes: number;
  truncated: boolean;
  payload: unknown;
  prev_hash: string | null;
  hash: string;
}

const LOG_COLUMNS =
  'run_id, seq, at, direction, kind, method, rpc_id, size_bytes, truncated, payload, prev_hash, hash';

function toHashedRow(row: LogRow): HashedRow {
  return {
    runId: row.run_id,
    seq: row.seq,
    at: row.at.toISOString(),
    direction: row.direction,
    kind: row.kind,
    method: row.method,
    rpcId: row.rpc_id,
    sizeBytes: row.size_bytes,
    truncated: row.truncated,
    payload: row.payload,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

function toLogEntry(row: LogRow): ProtocolLogEntry {
  return toHashedRow(row) as ProtocolLogEntry;
}

export async function insertProtocolEntries(
  db: Db,
  lease: Lease,
  entries: readonly ProtocolEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await withTransaction(db, async (client) => {
    await assertLeaseHeld(client, lease, false);
    await writeEntries(client, lease.runId, entries);
  });
}

export async function insertFinishedRunEntries(
  db: Db,
  runId: string,
  entries: readonly ProtocolEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await withTransaction(db, async (client) => {
    await client.query('SELECT id FROM runs WHERE id = $1 FOR UPDATE', [runId]);
    await writeEntries(client, runId, entries);
  });
}

async function writeEntries(
  client: DbClient,
  runId: string,
  entries: readonly ProtocolEntry[],
): Promise<void> {
  const last = await client.query<{ seq: number; hash: string }>(
    'SELECT seq, hash FROM run_protocol_log WHERE run_id = $1 ORDER BY seq DESC LIMIT 1',
    [runId],
  );
  const rows = chainRows(
    last.rows[0] ?? null,
    entries.map((entry) => ({
      runId,
      at: entry.at.toISOString(),
      direction: entry.direction,
      kind: entry.kind,
      method: entry.method,
      rpcId: entry.rpcId,
      sizeBytes: entry.sizeBytes,
      truncated: entry.truncated,
      payload: entry.payload,
    })),
  );
  await client.query(
    `INSERT INTO run_protocol_log (${LOG_COLUMNS})
     SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
       run_id uuid, seq integer, at timestamptz, direction text, kind text, method text,
       rpc_id text, size_bytes integer, truncated boolean, payload jsonb, prev_hash text,
       hash text)`,
    [
      JSON.stringify(
        rows.map((row) => ({
          run_id: row.runId,
          seq: row.seq,
          at: row.at,
          direction: row.direction,
          kind: row.kind,
          method: row.method,
          rpc_id: row.rpcId,
          size_bytes: row.sizeBytes,
          truncated: row.truncated,
          payload: row.payload,
          prev_hash: row.prevHash,
          hash: row.hash,
        })),
      ),
    ],
  );
}

export async function listProtocolLog(
  db: Queryable,
  runId: string,
  query: AuditLogQuery,
): Promise<AuditLogPage> {
  const conditions = ['run_id = $1', 'seq > $2'];
  const params: unknown[] = [runId, query.after];
  if (query.direction) {
    params.push(query.direction);
    conditions.push(`direction = $${params.length}`);
  }
  if (query.method) {
    params.push(query.method);
    conditions.push(`method = $${params.length}`);
  }
  if (query.q) {
    params.push(containsPattern(query.q));
    conditions.push(`payload::text ILIKE $${params.length}`);
  }
  params.push(query.limit + 1);
  const { rows } = await db.query<LogRow>(
    `SELECT ${LOG_COLUMNS} FROM run_protocol_log WHERE ${conditions.join(' AND ')}
     ORDER BY seq LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, query.limit);
  return {
    entries: page.map(toLogEntry),
    nextAfter: rows.length > query.limit ? (page.at(-1)?.seq ?? null) : null,
  };
}

export async function* protocolLogBatches(
  db: Queryable,
  runId: string,
  batchSize = 500,
): AsyncGenerator<ProtocolLogEntry[]> {
  let after = 0;
  for (;;) {
    const { rows } = await db.query<LogRow>(
      `SELECT ${LOG_COLUMNS} FROM run_protocol_log WHERE run_id = $1 AND seq > $2
       ORDER BY seq LIMIT $3`,
      [runId, after, batchSize],
    );
    if (rows.length === 0) return;
    yield rows.map(toLogEntry);
    after = rows.at(-1)!.seq;
    if (rows.length < batchSize) return;
  }
}

const VERIFY_BATCH_ROWS = 100;
const VERIFY_CHUNK_ROWS = 25;

export async function verifyRunLog(db: Queryable, runId: string): Promise<ChainVerification> {
  const run = await db.query<{ pruned: boolean }>(
    'SELECT protocol_log_pruned_at IS NOT NULL AS pruned FROM runs WHERE id = $1',
    [runId],
  );
  const pruned = run.rows[0]?.pruned ?? false;
  let position = CHAIN_START;
  for await (const batch of protocolLogBatches(db, runId, VERIFY_BATCH_ROWS)) {
    for (let start = 0; start < batch.length; start += VERIFY_CHUNK_ROWS) {
      await nextTurn();
      const chunk = batch.slice(start, start + VERIFY_CHUNK_ROWS) as HashedRow[];
      const check = verifyChain(chunk, position);
      if (!check.intact) {
        const { intact, checked, firstBrokenSeq, reason } = check;
        return { runId, intact, checked, firstBrokenSeq, reason, pruned };
      }
      position = check;
    }
  }
  return {
    runId,
    intact: true,
    checked: position.checked,
    firstBrokenSeq: null,
    reason: null,
    pruned,
  };
}

export async function pruneProtocolLog(db: Db, retentionDays: number): Promise<number> {
  return withTransaction(db, async (client) => {
    const expired = await client.query<{ id: string }>(
      `UPDATE runs SET protocol_log_pruned_at = now()
       WHERE COALESCE(finished_at, created_at) < now() - make_interval(days => $1)
         AND EXISTS (SELECT 1 FROM run_protocol_log l WHERE l.run_id = runs.id)
       RETURNING id`,
      [retentionDays],
    );
    if (expired.rows.length === 0) return 0;
    const deleted = await client.query('DELETE FROM run_protocol_log WHERE run_id = ANY($1)', [
      expired.rows.map((row) => row.id),
    ]);
    return deleted.rowCount ?? 0;
  });
}
