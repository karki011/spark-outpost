import { basename } from 'node:path';
import type { Db } from '../persistence/db.ts';
import type { Append } from './agent-turn.ts';
import { runEvents } from './run-events.ts';
import type { ProjectMove, RunInput } from './run-input.ts';

async function recordRoots(
  db: Db,
  runId: string,
  roots: readonly string[],
): Promise<string[] | null> {
  const { rows } = await db.query<{ project_roots: string[] }>(
    `WITH me AS (
       UPDATE runs SET project_roots = $2 WHERE id = $1
       RETURNING conversation_id, created_at
     )
     SELECT r.project_roots FROM runs r, me
     WHERE r.conversation_id = me.conversation_id AND r.parent_run_id IS NULL
       AND r.id <> $1 AND r.project_roots IS NOT NULL AND r.created_at <= me.created_at
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [runId, [...roots]],
  );
  return rows[0]?.project_roots ?? null;
}

export function projectMoveStep(move: ProjectMove): string {
  return `Project changed since the last turn: ${basename(move.from)} → ${basename(move.to)}`;
}

export function projectMoveNote(move: ProjectMove): string {
  return `Note: this chat's project folder changed from ${move.from} to ${move.to} since the earlier messages. Files, paths and work mentioned earlier refer to the old folder and may not exist here; check the current folder before relying on them.`;
}

export async function noteProjectMove(db: Db, input: RunInput, append: Append): Promise<RunInput> {
  if (input.parentRunId !== null) return input;
  const previous = await recordRoots(db, input.identity.runId, input.projectRoots);
  const from = previous?.[0];
  const to = input.projectRoots[0];
  if (!from || !to || from === to || input.history.length === 0) return input;
  const move = { from, to };
  const step = projectMoveStep(move);
  await append(runEvents.stepStarted(step));
  await append(runEvents.stepFinished(step));
  return { ...input, projectMove: move };
}

export function withMoveNote(input: Pick<RunInput, 'projectMove' | 'preamble'>): string | null {
  const parts = [input.projectMove ? projectMoveNote(input.projectMove) : null, input.preamble];
  const joined = parts.filter((part): part is string => Boolean(part)).join('\n\n');
  return joined || null;
}
