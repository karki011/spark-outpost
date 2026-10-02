import { decidePieceList, pieceListById } from '../persistence/pieces.ts';
import { getWorktree } from '../persistence/worktrees.ts';
import { commitTree } from '../projects/snapshot.ts';
import { checkAndFix, treeOf, type LandingSite } from '../orchestration/land.ts';
import { runMember, type MemberOutcome } from '../orchestration/members.ts';
import { mergeCopy, placeFor } from '../orchestration/solo-copy.ts';
import { publish, type MemberResult, type Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import { assess, recordAssessment, type Assessment } from './assess.ts';
import { askBuilders, type BuilderPlan } from './builder-jev.ts';
import { integratorRoute, integratorSeat } from './integrator.ts';
import { landedPieces, type PieceSite } from './piece-run.ts';
import { askPieceList } from './place-list.ts';
import { integratorSection } from './prompts.ts';
import { pieceSlots, runPieces } from './run-pieces.ts';
import { noteSection } from './notes.ts';
import { markNotesDelivered, pendingListNotes } from '../persistence/piece-notes.ts';
import { coordinatorMode, mayCoordinate } from './shadow.ts';
import type { Coordination } from './state.ts';
import { writePieceList, type PieceListResult } from './turn.ts';
import { projectSettings } from './builder-env.ts';

const BUILDS_IN_PIECES = new Set(['first', 'retry']);
const LIST_STOP_NOTE = 'You stopped it at the piece list.';
const NO_GLUE = 'No glue was planned; act on the notes below.';

function stopped(s: Session): boolean {
  return s.control.signal.aborted || s.budgetHit !== null;
}

function pieceSite(s: Session): PieceSite {
  const root = s.input.projectRoots[0]!;
  if (!s.needsCopy) return { cwd: async () => root, place: async () => null, copy: null };
  return {
    cwd: async () => {
      const record = s.copyRunId ? await getWorktree(s.deps.db, s.copyRunId) : null;
      return record?.path ?? root;
    },
    place: () => placeFor(s),
    copy: null,
  };
}

async function settleList(
  s: Session,
  assessment: Assessment,
  plan: BuilderPlan,
  first: PieceListResult,
): Promise<PieceListResult | 'stopped'> {
  let written = first;
  while (written.ok && written.value.list.status === 'proposed') {
    const list = written.value.list;
    await publish(s);
    const answer = await askPieceList(s, list, await pieceSlots(s));
    if (answer.kind === 'revise') {
      written = await writePieceList(s, assessment, plan, answer.note);
      continue;
    }
    if (answer.kind === 'stop') {
      await decidePieceList(s.deps.db, list.id, { status: 'rejected' });
      return 'stopped';
    }
    await decidePieceList(s.deps.db, list.id, {
      status: 'approved',
      approvedBy: 'user',
      ...(answer.kind === 'in_order' ? { inOrder: 'you chose to build in order' } : {}),
    });
    written = {
      ok: true,
      value: { ...written.value, list: (await pieceListById(s.deps.db, list.id))! },
    };
  }
  return written;
}

async function engage(s: Session): Promise<'stopped' | null> {
  const assessment = await assess(s);
  const plan = await askBuilders(s, assessment);
  await recordAssessment(s, assessment, false, plan);
  const engaged = plan.builders === null ? assessment.engagement.engage : plan.builders > 1;
  if (!engaged) return null;
  const root = s.input.projectRoots[0]!;
  const written = await settleList(s, assessment, plan, await writePieceList(s, assessment, plan));
  if (written === 'stopped') return written;
  s.coordination = {
    list: written.ok ? written.value.list : null,
    fallback: written.ok ? null : written.reason,
    owned: written.ok ? written.value.owned : new Map(),
    builderEnv: (await projectSettings(s.deps.db, s.lease.runId)).builderEnv,
    names: written.ok ? written.value.names : new Map(),
    topTier: written.ok ? written.value.topTier : new Set(),
    scoutNotes: [],
    violations: 0,
    integrated: false,
    integrator: null,
    base: await treeOf(s, root),
    unhealthy: new Map(),
  };
  await publish(s);
  return null;
}

async function landingSite(s: Session, coordination: Coordination): Promise<LandingSite> {
  const root = s.input.projectRoots[0]!;
  const record = s.copyRunId ? await getWorktree(s.deps.db, s.copyRunId) : null;
  if (!s.needsCopy || !record) return { cwd: root, before: coordination.base, place: null };
  return {
    cwd: record.path,
    before: await commitTree(record.repoRoot, record.baseCommit),
    place: { reuse: { runId: record.runId, branch: record.branch } },
  };
}

async function integrate(
  s: Session,
  action: Spawn,
  coordination: Coordination,
  site: PieceSite,
): Promise<MemberResult | null> {
  s.integrator = await integratorSeat(s, coordination);
  coordination.integrator = s.integrator.name;
  const integration = coordination.list?.integration ?? null;
  const notes = coordination.list ? await pendingListNotes(s.deps.db, coordination.list.id) : [];
  if ((!integration && notes.length === 0) || coordination.integrated) return null;
  const section = integratorSection(integration ?? NO_GLUE, landedPieces(coordination));
  const noted = noteSection(notes);
  const prompt = `${section}${noted ? `\n\n${noted}` : ''}\n\n## Request\n${s.input.userRequest}`;
  const { result } = await runMember(s, action, await site.place(), {
    seat: { ...s.integrator, prompt, memberRoute: integratorRoute(s, coordination, 'glue') },
  });
  await markNotesDelivered(
    s.deps.db,
    notes.map((note) => note.id),
    result.runId,
  );
  coordination.integrated = result.outcome === 'succeeded';
  return result;
}

function lastBuild(s: Session): MemberResult | null {
  return s.results.findLast((result) => result.role === 'builder') ?? null;
}

async function buildInPieces(
  s: Session,
  action: Spawn,
  coordination: Coordination,
): Promise<MemberOutcome> {
  const site = pieceSite(s);
  const run = await runPieces(s, action, coordination, site);
  if (run.failure) return { result: run.failure };
  const last = run.last;
  const spawn = last ? { ...action, escalate: false } : action;
  if (stopped(s) && last) return { result: last };
  const glue = await integrate(s, spawn, coordination, site);
  if (glue && glue.outcome !== 'succeeded') return { result: glue };
  const built = glue ?? last ?? lastBuild(s);
  if (!built) throw new Error('A coordinated build ran no Builder.');
  if (stopped(s)) return { result: built };
  const landed = await checkAndFix(s, built, await landingSite(s, coordination));
  if (!s.needsCopy || landed.result.outcome !== 'succeeded') return { result: landed.result };
  const merged = await mergeCopy(s, landed.result.name);
  return {
    result: { ...landed.result, outcome: merged === 'stopped' ? 'cancelled' : 'succeeded' },
  };
}

function stoppedAtList(s: Session): MemberResult {
  const coordinator = s.results.findLast((result) => result.role === 'coordinator')!;
  return { ...coordinator, outcome: 'cancelled', error: LIST_STOP_NOTE };
}

function buildsInPieces(action: Spawn, coordination: Coordination): boolean {
  if (BUILDS_IN_PIECES.has(action.reason)) return true;
  const open = (coordination.list?.pieces ?? []).some(
    (piece) => piece.status !== 'landed' && piece.status !== 'skipped',
  );
  return action.reason === 'resume' && open;
}

export async function coordinatedBuild(s: Session, action: Spawn): Promise<MemberOutcome | null> {
  const mode = coordinatorMode(s);
  if (action.role !== 'builder' || (mode !== 'in_order' && mode !== 'parallel')) return null;
  if (action.reason === 'first' && !s.coordination && mayCoordinate(s)) {
    if ((await engage(s)) === 'stopped') return { result: stoppedAtList(s) };
  }
  const coordination = s.coordination;
  if (!coordination?.list || !buildsInPieces(action, coordination)) return null;
  return buildInPieces(s, action, coordination);
}
