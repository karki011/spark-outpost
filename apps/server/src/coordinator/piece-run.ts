import { failingChecks, type CheckBody, type TaskPiece } from '@spark-outpost/contracts';
import { COORD_HANDOFF_SHARE, COORD_PIECE_FIX_TURNS } from '../advisor/policy.ts';
import { configuredChecks } from '../checks/detect.ts';
import { movePiece } from '../persistence/pieces.ts';
import { git, workingTree } from '../projects/snapshot.ts';
import { checkBudget } from '../orchestration/budget-check.ts';
import { runChecks } from '../orchestration/checks.ts';
import { builderPrompt, checkFailureText } from '../orchestration/context.ts';
import { treeOf } from '../orchestration/land.ts';
import { agreedPlanText } from '../orchestration/member-prompts.ts';
import { runMember, type Place } from '../orchestration/members.ts';
import { publish, type MemberResult, type Seat, type Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import type { Coordination } from './state.ts';
import { handoffSection, pieceSection, type LandedPiece } from './prompts.ts';

export interface PieceSite {
  cwd(): Promise<string>;
  place(): Promise<Place | null>;
  copy: string | null;
}

export interface PieceOutcome {
  result: MemberResult;
  landed: boolean;
}

interface PieceTurn {
  generation: number;
  result: MemberResult;
}

export function pieceKey(taskId: string, key: string, generation: number): string {
  const base = `${taskId}:piece:${key}`;
  return generation > 1 ? `${base}:${generation}` : base;
}

export function needsHandoff(used: number | null, size: number | null): boolean {
  if (used === null || size === null || size <= 0) return false;
  return used / size >= COORD_HANDOFF_SHARE;
}

async function contextOf(s: Session, runId: string): Promise<boolean> {
  const { rows } = await s.deps.db.query<{ used: number | null; size: number | null }>(
    'SELECT context_used AS used, context_size AS size FROM runs WHERE id = $1',
    [runId],
  );
  return needsHandoff(rows[0]?.used ?? null, rows[0]?.size ?? null);
}

export async function changedFiles(cwd: string, before: string | null): Promise<string[]> {
  if (!before) return [];
  const after = await workingTree(cwd).catch(() => null);
  if (!after || before === after) return [];
  const output = await git(cwd, ['diff', '--name-only', '--no-renames', before, after]);
  return output.split('\n').filter(Boolean);
}

export function landedPieces(coordination: Coordination): LandedPiece[] {
  return (coordination.list?.pieces ?? [])
    .filter((piece) => piece.status === 'landed' && !piece.research)
    .map((piece) => ({ key: piece.key, title: piece.title, files: piece.filesChanged }));
}

async function piecePrompt(s: Session, piece: TaskPiece, coordination: Coordination) {
  const brief = pieceSection({
    piece,
    owner: coordination.names.get(piece.key) ?? piece.key,
    others: (coordination.list?.pieces ?? [])
      .filter((other) => other.key !== piece.key)
      .map((other) => ({
        key: other.key,
        name: coordination.names.get(other.key) ?? null,
        owns: other.owns,
      })),
    landed: landedPieces(coordination),
    scoutNotes: coordination.scoutNotes.join('\n\n') || null,
  });
  if (piece.research) return `Request: ${s.input.userRequest}\n\n${brief}`;
  const base = builderPrompt({
    request: s.input.userRequest,
    history: [],
    note: null,
    findings: [],
    buildStyle: s.buildStyle,
    checkCommands: [],
    agreedPlan: await agreedPlanText(s),
  });
  return `${base}\n\n${brief}`;
}

function seatFor(
  s: Session,
  piece: TaskPiece,
  coordination: Coordination,
  generation: number,
  prompt: string,
): Seat {
  return {
    role: piece.research ? 'scout' : 'builder',
    name: coordination.names.get(piece.key) ?? piece.key,
    resumeKey: pieceKey(s.taskId!, piece.key, generation),
    prompt,
    route: { pieceKey: piece.key, placement: piece.placement },
  };
}

async function scopedChecks(
  s: Session,
  piece: TaskPiece,
  result: MemberResult,
  site: PieceSite,
): Promise<CheckBody | null> {
  if (piece.checks.length === 0) return null;
  return runChecks(
    s,
    { runId: result.runId, name: result.name, cwd: await site.cwd(), copy: site.copy },
    configuredChecks(piece.checks),
  );
}

async function fixTurn(
  s: Session,
  action: Spawn,
  piece: TaskPiece,
  coordination: Coordination,
  turn: PieceTurn,
  failing: CheckBody,
  site: PieceSite,
  before: string | null,
): Promise<PieceTurn> {
  const failures = checkFailureText(failingChecks(failing));
  const handoff = await contextOf(s, turn.result.runId);
  const generation = handoff ? turn.generation + 1 : turn.generation;
  const prompt = handoff
    ? `${await piecePrompt(s, piece, coordination)}\n\n${handoffSection(
        await changedFiles(await site.cwd(), before),
        failures,
      )}`
    : await piecePrompt(s, piece, coordination);
  const { result } = await runMember(
    s,
    { ...action, reason: 'fix', escalate: false, note: null },
    await site.place(),
    { checkFailures: failures, seat: seatFor(s, piece, coordination, generation, prompt) },
  );
  return { generation, result };
}

function stopped(s: Session): boolean {
  return s.control.signal.aborted || s.budgetHit !== null;
}

export async function runPiece(
  s: Session,
  action: Spawn,
  piece: TaskPiece,
  coordination: Coordination,
  site: PieceSite,
): Promise<PieceOutcome> {
  const db = s.deps.db;
  await movePiece(db, piece.id, ['pending', 'ready', 'failed'], 'running', {
    attempts: piece.attempts + 1,
  });
  await publish(s);
  const before = await treeOf(s, await site.cwd());
  const prompt = await piecePrompt(s, piece, coordination);
  const first = await runMember(s, action, await site.place(), {
    seat: seatFor(s, piece, coordination, 1, prompt),
  });
  let turn: PieceTurn = { generation: 1, result: first.result };
  await movePiece(db, piece.id, ['running'], 'running', { builderRunId: turn.result.runId });
  if (turn.result.outcome !== 'succeeded') {
    await movePiece(db, piece.id, ['running'], 'failed', { note: turn.result.error });
    await publish(s);
    return { result: turn.result, landed: false };
  }
  if (piece.research) coordination.scoutNotes.push(`${piece.key}: ${turn.result.text.trim()}`);
  let checks = await scopedChecks(s, piece, turn.result, site);
  let fixes = 0;
  while (checks?.status === 'failed' && fixes < COORD_PIECE_FIX_TURNS) {
    if (stopped(s) || (await checkBudget(s))) break;
    turn = await fixTurn(s, action, piece, coordination, turn, checks, site, before);
    fixes += 1;
    if (turn.result.outcome !== 'succeeded') break;
    checks = await scopedChecks(s, piece, turn.result, site);
  }
  if (turn.result.outcome !== 'succeeded') {
    await movePiece(db, piece.id, ['running'], 'failed', {
      fixTurns: fixes,
      note: turn.result.error,
    });
    await publish(s);
    return { result: turn.result, landed: false };
  }
  await movePiece(db, piece.id, ['running'], 'landed', {
    builderRunId: turn.result.runId,
    fixTurns: fixes,
    filesChanged: await changedFiles(await site.cwd(), before),
    check: checks === null ? 'none' : checks.status === 'failed' ? 'failed' : 'passed',
  });
  await publish(s);
  return { result: turn.result, landed: true };
}
