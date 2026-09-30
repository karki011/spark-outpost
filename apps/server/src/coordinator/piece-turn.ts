import type { TaskPiece } from '@spark-outpost/contracts';
import { COORD_NOTE_TURNS } from '../advisor/policy.ts';
import {
  markNotesDelivered,
  pendingPieceNotes,
  type StoredNote,
} from '../persistence/piece-notes.ts';
import { pieceListById } from '../persistence/pieces.ts';
import { checkFixFollowUp } from '../orchestration/context.ts';
import { runMember } from '../orchestration/members.ts';
import type { MemberResult, Seat, Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import {
  interruptedSection,
  moveAfterFailure,
  moveOnRequest,
  pieceChanges,
  type Moved,
} from './fallback.ts';
import { mergeMainInto } from './merge-main.ts';
import { deliverable, noteSection } from './notes.ts';
import type { PieceSite } from './piece-run.ts';
import { providerFailure } from './provider-state.ts';
import { revertFile } from './ownership.ts';
import { skipWithDependents } from './skip.ts';
import type { Coordination } from './state.ts';

export interface TurnWork {
  piece: TaskPiece;
  coordination: Coordination;
  site: PieceSite;
  before: string | null;
  brief(piece: TaskPiece): Promise<string>;
  seat(piece: TaskPiece, generation: number, prompt: string): Seat;
}

export interface TurnRequest {
  spawn: Spawn;
  generation: number;
  sections: readonly string[];
  checkFailures?: string;
}

export type TurnEnd =
  { skipped: false; result: MemberResult; generation: number } | { skipped: true };

interface Turn {
  spawn: Spawn;
  generation: number;
  sections: string[];
  checkFailures: string | null;
  ran: boolean;
  tried: Set<string>;
}

function stopped(s: Session): boolean {
  return s.control.signal.aborted || s.budgetHit !== null;
}

async function refresh(s: Session, work: TurnWork): Promise<void> {
  const listId = work.coordination.list?.id;
  const list = listId ? await pieceListById(s.deps.db, listId) : null;
  if (!list) return;
  work.coordination.list = list;
  work.piece = list.pieces.find((piece) => piece.key === work.piece.key) ?? work.piece;
}

async function skip(s: Session, work: TurnWork, notes: readonly StoredNote[]): Promise<TurnEnd> {
  const cwd = await work.site.cwd();
  if (work.before) {
    for (const file of await pieceChanges(cwd, work.before, work.coordination, work.piece)) {
      await revertFile(cwd, work.before, file);
    }
  }
  await markNotesDelivered(
    s.deps.db,
    notes.filter((note) => note.kind === 'skip').map((note) => note.id),
    null,
  );
  await skipWithDependents(s.deps.db, work.coordination.list?.pieces ?? [], work.piece);
  await refresh(s, work);
  return { skipped: true };
}

async function mergeMainFirst(
  s: Session,
  work: TurnWork,
  notes: readonly StoredNote[],
): Promise<string | null> {
  if (!notes.some((note) => note.kind === 'merge_main')) return null;
  const cwd = await work.site.cwd();
  const main = s.input.projectRoots[0]!;
  if (cwd === main) return null;
  const merged = await mergeMainInto(cwd, main);
  if (merged.conflicts.length === 0) return null;
  return `Main could not be merged into your copy cleanly (${merged.conflicts.join(', ')}); keep going, and the coordinator reconciles them when your piece lands.`;
}

function moveContext(work: TurnWork, turn: Turn) {
  return {
    piece: work.piece,
    coordination: work.coordination,
    site: work.site,
    before: work.before,
    lastCheck: turn.checkFailures,
  };
}

async function restart(s: Session, work: TurnWork, turn: Turn, moved: Moved & { moved: true }) {
  if (turn.ran || turn.spawn.reason !== 'first') turn.generation += 1;
  await refresh(s, work);
  turn.sections = [await work.brief(work.piece), ...(moved.handoff ? [moved.handoff] : [])];
}

async function reassignIfAsked(
  s: Session,
  work: TurnWork,
  turn: Turn,
  notes: readonly StoredNote[],
): Promise<void> {
  const asked = notes.filter((note) => note.kind === 'reassign');
  const last = asked.at(-1);
  if (!last) return;
  const moved = await moveOnRequest(s, moveContext(work, turn), last.body);
  await markNotesDelivered(
    s.deps.db,
    asked.map((note) => note.id),
    null,
  );
  if (moved.moved) await restart(s, work, turn, moved);
}

async function leaveUnhealthy(s: Session, work: TurnWork, turn: Turn): Promise<void> {
  const provider = work.piece.provider;
  const why = provider ? work.coordination.unhealthy.get(provider) : undefined;
  if (!why) return;
  const moved = await moveAfterFailure(s, moveContext(work, turn), why, turn.tried);
  if (moved.moved) await restart(s, work, turn, moved);
}

function followUp(notes: readonly StoredNote[], turn: Turn, merge: string | null): string | null {
  const parts = [
    noteSection(notes),
    merge,
    turn.checkFailures ? checkFixFollowUp(turn.checkFailures) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

async function runOnce(s: Session, work: TurnWork, turn: Turn): Promise<MemberResult | 'skip'> {
  await refresh(s, work);
  let notes = await pendingPieceNotes(s.deps.db, work.piece.id);
  if (work.piece.status === 'skipped' || notes.some((note) => note.kind === 'skip')) return 'skip';
  await reassignIfAsked(s, work, turn, notes);
  await leaveUnhealthy(s, work, turn);
  notes = deliverable(await pendingPieceNotes(s.deps.db, work.piece.id));
  const merge = await mergeMainFirst(s, work, notes);
  const extra = followUp(notes, turn, merge);
  const spawn: Spawn = extra ? { ...turn.spawn, followUp: extra } : turn.spawn;
  const prompt = turn.sections.join('\n\n');
  const { result } = await runMember(s, spawn, await work.site.place(), {
    seat: work.seat(work.piece, turn.generation, prompt),
  });
  turn.ran = true;
  if (providerFailure(result.error) === null) {
    await markNotesDelivered(
      s.deps.db,
      notes.map((note) => note.id),
      result.runId,
    );
  }
  return result;
}

async function wantsInterrupt(s: Session, work: TurnWork): Promise<'skip' | 'resume' | null> {
  const notes = await pendingPieceNotes(s.deps.db, work.piece.id);
  if (notes.some((note) => note.kind === 'skip')) return 'skip';
  const urgent = notes.some(
    (note) => note.kind === 'reassign' || (note.urgent && deliverable([note]).length > 0),
  );
  return urgent ? 'resume' : null;
}

export async function pieceTurn(
  s: Session,
  work: TurnWork,
  request: TurnRequest,
): Promise<TurnEnd> {
  const turn: Turn = {
    spawn: request.spawn,
    generation: request.generation,
    sections: [...request.sections],
    checkFailures: request.checkFailures ?? null,
    ran: false,
    tried: new Set(),
  };
  let noteTurns = 0;
  for (;;) {
    const result = await runOnce(s, work, turn);
    if (result === 'skip') return skip(s, work, await pendingPieceNotes(s.deps.db, work.piece.id));
    const end = { skipped: false as const, result, generation: turn.generation };
    if (stopped(s)) return end;
    const why = result.outcome === 'failed' ? providerFailure(result.error) : null;
    if (why) {
      const moved = await moveAfterFailure(s, moveContext(work, turn), why, turn.tried);
      if (!moved.moved) return { ...end, result: { ...result, error: moved.reason } };
      await restart(s, work, turn, moved);
      continue;
    }
    if (result.outcome === 'cancelled') {
      const interrupt = await wantsInterrupt(s, work);
      if (interrupt === 'skip') {
        return skip(s, work, await pendingPieceNotes(s.deps.db, work.piece.id));
      }
      if (!interrupt) return end;
      const cwd = await work.site.cwd();
      const files = work.before
        ? await pieceChanges(cwd, work.before, work.coordination, work.piece)
        : [];
      turn.sections = [await work.brief(work.piece), interruptedSection(files)];
      continue;
    }
    if (result.outcome !== 'succeeded' || noteTurns >= COORD_NOTE_TURNS) return end;
    const waiting = deliverable(await pendingPieceNotes(s.deps.db, work.piece.id));
    if (waiting.length === 0) return end;
    noteTurns += 1;
    await refresh(s, work);
    turn.sections = [await work.brief(work.piece), ...turn.sections.slice(1)];
    turn.spawn = { ...request.spawn, reason: 'fix', escalate: false, note: null };
    turn.checkFailures = null;
  }
}
