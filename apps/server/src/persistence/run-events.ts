import type { RunEvent, RunStatus } from '@spark-outpost/contracts';
import { writeArtifact, type ArtifactWrite } from './artifacts.ts';
import { applyAutoTitle } from './auto-title.ts';
import { withTransaction, type Db, type DbClient } from './db.ts';
import type { Lease } from './jobs.ts';

export class LeaseLostError extends Error {
  constructor(lease: Lease) {
    super(`Lease for job ${lease.jobId} is no longer held by this worker.`);
  }
}

export interface RunTransition {
  status: RunStatus;
  error?: string;
}

export interface AssistantMessageRecord {
  id: string;
  content: string;
}

export interface AppendOptions {
  transition?: RunTransition;
  assistantMessage?: AssistantMessageRecord;
  artifact?: ArtifactWrite;
  expectExpired?: boolean;
}

const finalStatuses = new Set<RunStatus>(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);

function jobStatusFor(status: RunStatus): 'done' | 'failed' {
  return status === 'succeeded' || status === 'cancelled' ? 'done' : 'failed';
}

export async function appendRunEvent(
  db: Db,
  lease: Lease,
  event: RunEvent,
  options: AppendOptions = {},
): Promise<number> {
  return appendRunEvents(db, lease, [event], options);
}

export async function appendRunEvents(
  db: Db,
  lease: Lease,
  events: readonly RunEvent[],
  options: AppendOptions = {},
): Promise<number> {
  return withTransaction(db, async (client) => {
    await assertLeaseHeld(client, lease, options.expectExpired ?? false);
    const seq = await insertRunEvents(client, lease.runId, events);
    if (options.assistantMessage) {
      await insertAssistantMessage(client, lease.runId, options.assistantMessage);
    }
    if (options.artifact) {
      await writeArtifact(client, lease.runId, options.artifact);
    }
    if (options.transition) {
      await applyTransition(client, lease, options.transition);
    }
    await client.query(`SELECT pg_notify('run_events', $1)`, [lease.runId]);
    return seq;
  });
}

export async function insertRunEvent(
  client: DbClient,
  runId: string,
  event: RunEvent,
): Promise<number> {
  return insertRunEvents(client, runId, [event]);
}

async function insertRunEvents(
  client: DbClient,
  runId: string,
  events: readonly RunEvent[],
): Promise<number> {
  const next = await client.query<{ seq: number }>(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id = $1',
    [runId],
  );
  const first = next.rows[0]!.seq;
  await client.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, $2::integer + listed.position::integer - 1, listed.type, listed.payload::jsonb
     FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS listed(type, payload, position)
     ORDER BY listed.position`,
    [runId, first, events.map((event) => event.type), events.map((event) => JSON.stringify(event))],
  );
  return first + events.length - 1;
}

export async function assertLeaseHeld(client: DbClient, lease: Lease, expectExpired: boolean) {
  const expiry = expectExpired ? 'lease_expires_at <= now()' : 'lease_expires_at > now()';
  const { rowCount } = await client.query(
    `SELECT 1 FROM jobs
     WHERE id = $1 AND lease_token = $2 AND status = 'leased' AND ${expiry}
     FOR UPDATE`,
    [lease.jobId, lease.token],
  );
  if (rowCount !== 1) throw new LeaseLostError(lease);
}

async function insertAssistantMessage(
  client: DbClient,
  runId: string,
  message: AssistantMessageRecord,
) {
  await client.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $2, id FROM runs WHERE id = $3`,
    [message.id, message.content, runId],
  );
}

async function applyTransition(client: DbClient, lease: Lease, transition: RunTransition) {
  const isFinal = finalStatuses.has(transition.status);
  await client.query(
    `UPDATE runs SET
       status = $2,
       error = $3,
       started_at = COALESCE(started_at, now()),
       finished_at = CASE WHEN $4 THEN now() ELSE finished_at END
     WHERE id = $1`,
    [lease.runId, transition.status, transition.error ?? null, isFinal],
  );
  await client.query(
    'UPDATE conversations SET updated_at = now() WHERE id = (SELECT conversation_id FROM runs WHERE id = $1)',
    [lease.runId],
  );
  if (transition.status === 'succeeded') await applyAutoTitle(client, lease.runId);
  if (isFinal) {
    await client.query(
      `UPDATE jobs SET status = $2, lease_token = NULL, lease_expires_at = NULL, updated_at = now(),
         last_error = $3
       WHERE id = $1`,
      [lease.jobId, jobStatusFor(transition.status), transition.error ?? null],
    );
  }
}

export async function isCancelRequested(db: Db, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ requested: boolean }>(
    'SELECT cancel_requested_at IS NOT NULL AS requested FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.requested ?? false;
}
