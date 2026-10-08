import { type CheckBody, type PieceViolation, type TaskPiece } from '@spark-outpost/contracts';
import { COORD_HANDOFF_SHARE, COORD_PIECE_FIX_TURNS } from '../advisor/policy.ts';
import { configuredChecks } from '../checks/detect.ts';
import { movePiece, pieceListById } from '../persistence/pieces.ts';
import { git, workingTree } from '../projects/snapshot.ts';
import { runChecks } from '../orchestration/checks.ts';
import { changeFailureText, startsCheckFix } from '../orchestration/check-results.ts';
import { builderPrompt } from '../orchestration/context.ts';
import { treeOf } from '../orchestration/land.ts';
import { codeContext } from '../orchestration/code-context.ts';
import { agreedPlanText } from '../orchestration/member-prompts.ts';
import type { Place } from '../orchestration/members.ts';
import { publish, type MemberResult, type Seat, type Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import type { Coordination } from './state.ts';
import { handoffSection, pieceSection, type LandedPiece } from './prompts.ts';
import { builderEnvFor, withCheckLock } from './builder-env.ts';
import { routeRequirement } from './follow-up.ts';
import { attributableOwner, reportCrossings } from './crossings.ts';
import { editEvidence } from './edit-evidence.ts';
import { neededFiles, needText } from './needs.ts';
import { owns } from './owned.ts';
import { checkOwnership, ownedFilesFor, violationNote } from './ownership.ts';
import { announceLanding } from './landing-notices.ts';
import { pieceTurn, type TurnWork } from './piece-turn.ts';
import { STOPPED_BY_USER } from './skip.ts';
import { pieceRoute } from './provider-state.ts';

export interface PieceSite {
  cwd(): Promise<string>;
  place(): Promise<Place | null>;
  slot?: number;
  changed?(before: string | null): Promise<string[]>;
}

export type PieceOutcome =
  { result: MemberResult; landed: boolean; skipped?: false } | { skipped: true; landed: false };

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
  const output = await git(cwd, [
    'diff',
    '--name-only',
    '--no-renames',
    '--relative',
    before,
    after,
  ]);
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
  const owned = coordination.owned.get(piece.key) ?? { paths: [], globs: [] };
  const relevant = (path: string) => owns(owned, path) || piece.reads.includes(path);
  const base = builderPrompt({
    request: s.input.userRequest,
    history: [],
    note: null,
    findings: [],
    buildStyle: s.buildStyle,
    checkCommands: [],
    agreedPlan: await agreedPlanText(s),
    likelyFiles: await codeContext(s, relevant),
  });
  return `${base}\n\n${brief}`;
}

function seatFor(
  s: Session,
  piece: TaskPiece,
  coordination: Coordination,
  slot: number,
  generation: number,
  prompt: string,
): Seat {
  const name = coordination.names.get(piece.key) ?? piece.key;
  const guard = piece.research
    ? {}
    : { guard: { coordinated: true, owned: ownedFilesFor(coordination, piece) } };
  const memberRoute = pieceRoute(s, piece);
  return {
    role: piece.research ? 'scout' : 'builder',
    name,
    resumeKey: pieceKey(s.taskId!, piece.key, generation),
    prompt,
    ...(memberRoute ? { memberRoute } : {}),
    route: {
      pieceKey: piece.key,
      placement: piece.placement,
      ...guard,
      builderEnv: builderEnvFor(coordination.builderEnv, slot, name),
    },
  };
}

interface PieceWork extends TurnWork {
  since: string;
  violations: PieceViolation[];
  note: string | null;
}

interface CheckSite {
  cwd: string;
  slot: number;
}

export async function runPieceChecks(
  s: Session,
  coordination: Coordination,
  piece: TaskPiece,
  result: MemberResult,
  site: CheckSite,
): Promise<CheckBody | null> {
  if (piece.checks.length === 0) return null;
  const target = {
    runId: result.runId,
    name: result.name,
    cwd: site.cwd,
    copy: null,
    env: builderEnvFor(coordination.builderEnv, site.slot, result.name),
  };
  const run = () => runChecks(s, target, configuredChecks(piece.checks));
  if (coordination.builderEnv) return run();
  return withCheckLock(s.deps.db, s.input.projectRoots[0]!, run);
}

async function scopedChecks(
  s: Session,
  work: PieceWork,
  result: MemberResult,
): Promise<CheckBody | null> {
  const { piece, coordination, site } = work;
  if (piece.checks.length === 0) return null;
  return runPieceChecks(s, coordination, piece, result, {
    cwd: await site.cwd(),
    slot: site.slot ?? 1,
  });
}

async function fixTurn(
  s: Session,
  action: Spawn,
  work: PieceWork,
  turn: PieceTurn,
  failing: CheckBody,
): Promise<PieceTurn | null> {
  const failures = changeFailureText(failing);
  const handoff = await contextOf(s, turn.result.runId);
  const generation = handoff ? turn.generation + 1 : turn.generation;
  const sections = [await work.brief(work.piece)];
  if (handoff) sections.push(handoffSection(await pieceChanges(work), failures));
  if (work.note) sections.push(work.note);
  const end = await pieceTurn(s, work, {
    spawn: { ...action, reason: 'fix', escalate: false, note: null },
    generation,
    sections,
    checkFailures: failures,
  });
  return end.skipped ? null : { generation: end.generation, result: end.result };
}

function pieceChanges(work: PieceWork): Promise<string[]> {
  if (work.site.changed) return work.site.changed(work.before);
  return work.site.cwd().then((cwd) => changedFiles(cwd, work.before));
}

function workerLabel(work: PieceWork): string {
  const name = work.coordination.names.get(work.piece.key);
  return name ? `${name} (${work.piece.key})` : work.piece.key;
}

async function askOthers(
  s: Session,
  work: PieceWork,
  wanted: readonly { path: string; body: string }[],
): Promise<void> {
  const listId = work.coordination.list?.id;
  const list = listId && wanted.length > 0 ? await pieceListById(s.deps.db, listId) : null;
  if (!list) return;
  for (const { path, body } of wanted) {
    await routeRequirement(s.deps.db, list, {
      body,
      files: [path],
      source: 'coordinator',
      from: work.piece.key,
    });
  }
}

async function reportNeeds(s: Session, work: PieceWork, reply: string): Promise<void> {
  const owned = ownedFilesFor(work.coordination, work.piece);
  const wanted = neededFiles(reply)
    .filter((need) => !owns(owned, need.path))
    .map((need) => ({ path: need.path, body: needText(workerLabel(work), need) }));
  await askOthers(s, work, wanted);
}

async function guardTurn(s: Session, work: PieceWork, result: MemberResult): Promise<void> {
  const listId = work.coordination.list?.id;
  if (work.piece.research || !work.before || !listId) return;
  const cwd = await work.site.cwd();
  const list = await pieceListById(s.deps.db, listId);
  if (!list) return;
  const seen = new Set(work.violations.map((violation) => violation.path));
  const violations = checkOwnership(
    work.coordination,
    work.piece,
    (await changedFiles(cwd, work.before)).filter((file) => !seen.has(file)),
    attributableOwner(list, work.since),
    await editEvidence(s.deps.db, s.lease.runId, work.piece.key, cwd),
  );
  work.note = violationNote(violations);
  if (violations.length === 0) return;
  await reportCrossings(
    s.deps.db,
    list,
    {
      runId: result.runId,
      worker: result.name,
      workerLabel: workerLabel(work),
      pieceKey: work.piece.key,
      cwd,
      before: work.before,
      after: await workingTree(cwd).catch(() => null),
    },
    violations,
  );
  work.violations.push(...violations);
  const owned = work.coordination.owned.get(work.piece.key);
  await movePiece(s.deps.db, work.piece.id, ['running'], 'running', {
    violations: work.violations,
    ...(owned ? { owns: [...owned.paths, ...owned.globs] } : {}),
  });
}

function stopped(s: Session): boolean {
  return s.control.signal.aborted;
}

async function failPiece(
  s: Session,
  work: PieceWork,
  result: MemberResult,
  patch: { fixTurns?: number; note?: string | null } = {},
): Promise<PieceOutcome> {
  const stoppedByUser = result.outcome === 'cancelled';
  await movePiece(s.deps.db, work.piece.id, ['running'], stoppedByUser ? 'stopped' : 'failed', {
    note: stoppedByUser ? STOPPED_BY_USER : result.error,
    ...patch,
  });
  await publish(s);
  return { result, landed: false };
}

export const NO_CHANGES_NOTE = 'The Builder changed none of its files.';

export const NOTHING_CHANGED_SECTION = [
  '## Note from the coordinator',
  "Your last turn changed none of your files, so the piece can't land. Make the changes the piece needs now. If a tool call was refused, read the reason and use another way, such as the edit tool for each file.",
].join('\n');

function expectsChanges(piece: TaskPiece): boolean {
  return !piece.research && piece.owns.length > 0;
}

async function changedNothing(work: PieceWork): Promise<boolean> {
  return (await pieceChanges(work)).length === 0;
}

async function nudgeTurn(s: Session, action: Spawn, work: PieceWork, turn: PieceTurn) {
  const end = await pieceTurn(s, work, {
    spawn: { ...action, reason: 'fix', escalate: false, note: null },
    generation: turn.generation,
    sections: [await work.brief(work.piece), NOTHING_CHANGED_SECTION],
  });
  return end.skipped ? null : { generation: end.generation, result: end.result };
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
  const work: PieceWork = {
    piece,
    coordination,
    site,
    before: await treeOf(s, await site.cwd()),
    since: new Date().toISOString(),
    violations: [],
    note: null,
    brief: (current) => piecePrompt(s, current, coordination),
    seat: (current, generation, prompt) =>
      seatFor(s, current, coordination, site.slot ?? 1, generation, prompt),
  };
  const first = await pieceTurn(s, work, {
    spawn: action,
    generation: 1,
    sections: [await work.brief(piece)],
  });
  if (first.skipped) return { skipped: true, landed: false };
  let turn: PieceTurn = { generation: first.generation, result: first.result };
  await movePiece(db, piece.id, ['running'], 'running', { builderRunId: turn.result.runId });
  if (turn.result.outcome !== 'succeeded') return failPiece(s, work, turn.result);
  await guardTurn(s, work, turn.result);
  if (piece.research) coordination.scoutNotes.push(`${piece.key}: ${turn.result.text.trim()}`);
  let fixes = 0;
  if (expectsChanges(piece) && (await changedNothing(work)) && !stopped(s)) {
    const nudged = await nudgeTurn(s, action, work, turn);
    if (!nudged) return { skipped: true, landed: false };
    turn = nudged;
    fixes += 1;
    if (turn.result.outcome !== 'succeeded') {
      return failPiece(s, work, turn.result, { fixTurns: fixes });
    }
    await guardTurn(s, work, turn.result);
    if (await changedNothing(work)) {
      return failPiece(
        s,
        work,
        { ...turn.result, outcome: 'failed', error: NO_CHANGES_NOTE },
        { fixTurns: fixes, note: NO_CHANGES_NOTE },
      );
    }
  }
  let checks = await scopedChecks(s, work, turn.result);
  while (fixes < COORD_PIECE_FIX_TURNS && startsCheckFix(s, checks)) {
    if (stopped(s)) break;
    const fixed = await fixTurn(s, action, work, turn, checks);
    if (!fixed) return { skipped: true, landed: false };
    turn = fixed;
    fixes += 1;
    if (turn.result.outcome !== 'succeeded') break;
    await guardTurn(s, work, turn.result);
    checks = await scopedChecks(s, work, turn.result);
  }
  if (turn.result.outcome !== 'succeeded')
    return failPiece(s, work, turn.result, { fixTurns: fixes });
  if (!piece.research) await reportNeeds(s, work, turn.result.text);
  await movePiece(db, piece.id, ['running'], 'landed', {
    builderRunId: turn.result.runId,
    fixTurns: fixes,
    filesChanged: await pieceChanges(work),
    check: checks === null ? 'none' : checks.status === 'failed' ? 'failed' : 'passed',
  });
  await announceLanding(s, work, turn.result.name);
  await publish(s);
  return { result: turn.result, landed: true };
}
