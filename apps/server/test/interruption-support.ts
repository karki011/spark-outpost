import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { eventually, type TestDb } from './support.ts';

export async function expireLeases(t: TestDb, runId: string): Promise<void> {
  await t.db.query(
    `UPDATE jobs SET lease_expires_at = now() - interval '1 second'
     WHERE status = 'leased'
       AND run_id IN (SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1)`,
    [runId],
  );
}

export function untilStatus(t: TestDb, runId: string, status: Run['status']): Promise<Run> {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.status === status ? run : null;
  }, 30_000);
}

export function untilFinished(t: TestDb, runId: string): Promise<Run> {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 30_000);
}

export function fakePrompts(store: string, sessionId: string): string[] {
  const stored = JSON.parse(readFileSync(join(store, `${sessionId}.json`), 'utf8')) as {
    prompts: string[];
  };
  return stored.prompts;
}

export async function stepNames(t: TestDb, runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT e.payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND e.type = 'STEP_STARTED'
     ORDER BY e.created_at, e.seq`,
    [runId],
  );
  return rows.map((row) => row.name);
}

export async function auditMethods(t: TestDb, runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ method: string }>(
    `SELECT l.method FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND l.method IS NOT NULL
     ORDER BY l.at, l.seq`,
    [runId],
  );
  return rows.map((row) => row.method);
}

export async function resumedSessionIds(t: TestDb, runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ session_id: string }>(
    `SELECT l.payload->'params'->>'sessionId' AS session_id
     FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND l.direction = 'to_agent'
       AND l.method IN ('session/resume', 'session/load')
     ORDER BY l.at, l.seq`,
    [runId],
  );
  return rows.map((row) => row.session_id);
}
