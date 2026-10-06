import {
  commandRunSchema,
  type CommandFinished,
  type CommandOutputResponse,
  type CommandRun,
  type CommandStarted,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface CommandRow {
  id: string;
  run_id: string;
  command: string;
  cwd: string | null;
  live: boolean;
  status: string;
  run_ended: boolean;
  exit_code: number | null;
  output_chars: string;
  text_offset: number | null;
  text_before: string | null;
  text_held: number | null;
  started_at: Date;
  finished_at: Date | null;
  run_finished_at: Date | null;
}

const RUN_ENDED = `r.status IN ('succeeded', 'failed', 'cancelled', 'outcome_unknown')`;

function toCommand(row: CommandRow): CommandRun {
  const cutShort = row.status === 'running' && row.run_ended;
  return commandRunSchema.parse({
    id: row.id,
    runId: row.run_id,
    command: row.command,
    cwd: row.cwd,
    live: row.live,
    status: cutShort ? 'interrupted' : row.status,
    exitCode: row.exit_code,
    startedAt: row.started_at.toISOString(),
    finishedAt: (row.finished_at ?? (cutShort ? row.run_finished_at : null))?.toISOString() ?? null,
    outputChars: Number(row.output_chars),
    textOffset: row.text_offset,
    textBefore: row.text_before,
    textHeld: row.text_held,
  });
}

export async function insertCommand(
  db: Queryable,
  runId: string,
  command: CommandStarted,
): Promise<void> {
  await db.query(
    `INSERT INTO run_commands
       (id, run_id, conversation_id, command, cwd, live, started_at,
        text_offset, text_before, text_held)
     SELECT $1, r.id, r.conversation_id, $3, $4, $5, $6, $7, $8, $9
     FROM runs r WHERE r.id = $2
     ON CONFLICT (id) DO NOTHING`,
    [
      command.id,
      runId,
      command.command,
      command.cwd,
      command.live,
      command.startedAt,
      command.textOffset,
      command.textBefore,
      command.textHeld,
    ],
  );
}

export async function saveCommandOutput(
  db: Queryable,
  id: string,
  output: string,
  outputChars: number,
): Promise<void> {
  await db.query(
    `UPDATE run_commands SET output = $2, output_chars = $3
     WHERE id = $1 AND status = 'running' AND output_chars <= $3`,
    [id, output, outputChars],
  );
}

export async function finishCommand(
  db: Queryable,
  finished: CommandFinished,
  output: string,
): Promise<void> {
  await db.query(
    `UPDATE run_commands
     SET status = $2, exit_code = $3, finished_at = $4, output = $5, output_chars = $6
     WHERE id = $1 AND status = 'running'`,
    [
      finished.id,
      finished.status,
      finished.exitCode,
      finished.finishedAt,
      output,
      finished.outputChars,
    ],
  );
}

export async function listCommands(db: Queryable, conversationId: string): Promise<CommandRun[]> {
  const result = await db.query<CommandRow>(
    `SELECT c.id, c.run_id, c.command, c.cwd, c.live, c.status, c.exit_code, c.output_chars,
            c.text_offset, c.text_before, c.text_held, c.started_at, c.finished_at,
            ${RUN_ENDED} AS run_ended, r.finished_at AS run_finished_at
     FROM run_commands c JOIN runs r ON r.id = c.run_id
     WHERE c.conversation_id = $1
     ORDER BY c.started_at, c.id`,
    [conversationId],
  );
  return result.rows.map(toCommand);
}

export async function commandOutput(
  db: Queryable,
  runId: string,
  id: string,
): Promise<CommandOutputResponse | null> {
  const result = await db.query<{ output: string; output_chars: string }>(
    'SELECT output, output_chars FROM run_commands WHERE id = $1 AND run_id = $2',
    [id, runId],
  );
  const row = result.rows[0];
  return row ? { output: row.output, outputChars: Number(row.output_chars) } : null;
}
