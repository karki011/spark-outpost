import type { Db } from '../../../apps/server/src/persistence/db.ts';
import type { RunOutcome } from '../runner/failure.ts';
import type { CommandTiming, LogRow, OutputEvent } from './types.ts';

export async function commandRows(db: Db, runIds: string[]): Promise<CommandTiming[]> {
  const { rows } = await db.query<{
    id: string;
    run_id: string;
    command: string;
    started_at: Date;
    finished_at: Date | null;
    exit_code: number | null;
    status: string;
  }>(
    `SELECT id, run_id, command, started_at, finished_at, exit_code, status
     FROM run_commands WHERE run_id = ANY($1) ORDER BY started_at`,
    [runIds],
  );
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    command: row.command,
    startedAt: row.started_at.getTime(),
    finishedAt: row.finished_at?.getTime() ?? null,
    exitCode: row.exit_code,
    status: row.status,
  }));
}

export async function outputEvents(db: Db, runIds: string[]): Promise<OutputEvent[]> {
  const { rows } = await db.query<{ command_id: string; created_at: Date }>(
    `SELECT payload->'value'->>'id' AS command_id, created_at FROM run_events
     WHERE run_id = ANY($1) AND type = 'CUSTOM' AND payload->>'name' = 'command_output'
     ORDER BY run_id, seq`,
    [runIds],
  );
  return rows.map((row) => ({ commandId: row.command_id, at: row.created_at.getTime() }));
}

export async function protocolRows(db: Db, runIds: string[]): Promise<LogRow[]> {
  const { rows } = await db.query<{
    run_id: string;
    seq: number;
    at: Date;
    direction: string;
    kind: string;
    method: string | null;
    payload: unknown;
    unreviewed: boolean | null;
  }>(
    `SELECT run_id, seq, at, direction, kind, method, payload, unreviewed FROM run_protocol_log
     WHERE run_id = ANY($1) ORDER BY run_id, seq`,
    [runIds],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    seq: row.seq,
    at: row.at.getTime(),
    direction: row.direction,
    kind: row.kind,
    method: row.method,
    payload: row.payload,
    unreviewed: row.unreviewed === true,
  }));
}

export async function runOutcomes(db: Db, runIds: string[]): Promise<RunOutcome[]> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    error: string | null;
    error_details: string | null;
  }>('SELECT id, status, error, error_details FROM runs WHERE id = ANY($1) ORDER BY created_at', [
    runIds,
  ]);
  return rows.map((row) => ({
    runId: row.id,
    status: row.status,
    error: row.error,
    details: row.error_details,
  }));
}
