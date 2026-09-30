import {
  STEER_ALL,
  STEER_COORDINATOR,
  type PieceList,
  type SteerResponse,
  type TaskPiece,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { addRequirement, insertPieceNote, runningPieceRuns } from '../persistence/piece-notes.ts';
import { currentPieceList } from '../persistence/pieces.ts';
import { requestCancel } from '../persistence/runs.ts';
import { skipBlocker, skipDependents, skipWithDependents } from './skip.ts';
import { catalogEntry } from '../providers/catalog.ts';
import type { SteerPlan } from './steer-rules.ts';

export class SteerError extends Error {
  constructor(
    readonly status: 404 | 409 | 400,
    message: string,
  ) {
    super(message);
  }
}

const OPEN = new Set(['pending', 'ready', 'running']);
const QUOTE_LIMIT = 80;

interface Running {
  list: PieceList;
  orchestrationRunId: string;
}

async function runningList(db: Queryable, taskId: string): Promise<Running> {
  const list = await currentPieceList(db, taskId);
  if (!list) throw new SteerError(404, 'This task has no pieces to steer.');
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT r.id, r.status FROM piece_lists l JOIN runs r ON r.id = l.orchestration_run_id
     WHERE l.id = $1`,
    [list.id],
  );
  const run = rows[0];
  if (!run || !['running', 'awaiting_approval', 'queued'].includes(run.status)) {
    throw new SteerError(409, 'The pieces have finished; send a new message instead.');
  }
  return { list, orchestrationRunId: run.id };
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE_LIMIT ? `${flat.slice(0, QUOTE_LIMIT)}…` : flat;
}

function label(piece: TaskPiece): string {
  return piece.builderName ?? `${piece.key} · ${piece.title}`;
}

async function interrupt(db: Queryable, piece: TaskPiece): Promise<void> {
  for (const runId of await runningPieceRuns(db, piece.id)) await requestCancel(db, runId);
}

function response(plan: SteerPlan, pieces: readonly string[], reply: string): SteerResponse {
  return { kind: plan.kind, target: plan.target, pieces: [...pieces], reply };
}

async function skip(db: Queryable, list: PieceList, piece: TaskPiece, plan: SteerPlan) {
  const blocked = skipBlocker(piece);
  if (blocked) throw new SteerError(409, blocked);
  if (piece.status !== 'running') {
    const skipped = await skipWithDependents(db, list.pieces, piece);
    return response(plan, skipped, `Skipped ${skipped.join(', ')}.`);
  }
  await insertPieceNote(
    db,
    { pieceId: piece.id },
    { kind: 'skip', body: plan.body, source: 'user', urgent: true },
  );
  const dependents = await skipDependents(db, list.pieces, piece.key);
  await interrupt(db, piece);
  const also = dependents.length > 0 ? ` and ${dependents.join(', ')}` : '';
  return response(
    plan,
    [piece.key, ...dependents],
    `Skipping ${piece.key}${also}: stopping ${label(piece)} and reverting its changes.`,
  );
}

async function noteFor(db: Queryable, piece: TaskPiece, plan: SteerPlan, urgent: boolean) {
  if (plan.kind === 'requirement_added') await addRequirement(db, piece.id, plan.body);
  const now = urgent || plan.kind === 'reassign';
  await insertPieceNote(
    db,
    { pieceId: piece.id },
    { kind: plan.kind, body: plan.body, source: 'user', urgent: now },
  );
  if (plan.kind === 'reassign' && piece.status === 'running') await interrupt(db, piece);
}

function targets(list: PieceList, plan: SteerPlan): TaskPiece[] {
  const open = list.pieces.filter((piece) => OPEN.has(piece.status) && !piece.research);
  if (plan.target === STEER_ALL) return open;
  const piece = list.pieces.find((entry) => entry.key === plan.target);
  if (!piece) throw new SteerError(404, `There is no piece ${plan.target}.`);
  if (!OPEN.has(piece.status)) {
    throw new SteerError(
      409,
      `${piece.key} has ${piece.status}; steer another piece or all of them.`,
    );
  }
  return [piece];
}

function queuedReply(plan: SteerPlan, pieces: readonly TaskPiece[], urgent: boolean): string {
  if (plan.kind === 'reassign') {
    const to = plan.provider ? catalogEntry(plan.provider).name : 'another provider';
    return `Moving ${pieces.map((piece) => piece.key).join(', ')} to ${to}.`;
  }
  const who = pieces.length === 1 ? label(pieces[0]!) : `${pieces.length} pieces`;
  const when = urgent ? 'now' : 'next turn';
  return `Queued for ${who}: ${quote(plan.body)} (${when})`;
}

export async function applySteer(
  db: Queryable,
  taskId: string,
  plan: SteerPlan,
  urgent = false,
): Promise<SteerResponse> {
  const { list, orchestrationRunId } = await runningList(db, taskId);
  if (plan.kind === 'stop') {
    await requestCancel(db, orchestrationRunId);
    return response(plan, [], 'Stopping the task.');
  }
  if (plan.target === STEER_COORDINATOR) {
    await insertPieceNote(
      db,
      { listId: list.id },
      { kind: plan.kind, body: plan.body, source: 'user', urgent: false },
    );
    return response(plan, [], `Queued for the coordinator: ${quote(plan.body)} (at integration)`);
  }
  if (plan.kind === 'skip') {
    const piece = list.pieces.find((entry) => entry.key === plan.target);
    if (!piece) throw new SteerError(404, `There is no piece ${plan.target}.`);
    return skip(db, list, piece, plan);
  }
  const pieces = targets(list, plan);
  if (pieces.length === 0) throw new SteerError(409, 'No piece is still open.');
  for (const piece of pieces) await noteFor(db, piece, plan, urgent);
  return response(
    plan,
    pieces.map((piece) => piece.key),
    queuedReply(plan, pieces, urgent),
  );
}
