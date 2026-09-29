import { nextCrewName } from '@spark-outpost/contracts';
import { pieceListById } from '../persistence/pieces.ts';
import { usedNames } from '../persistence/orchestrations.ts';
import { getWorktree } from '../persistence/worktrees.ts';
import { commitTree } from '../projects/snapshot.ts';
import { checkAndFix, treeOf, type LandingSite } from '../orchestration/land.ts';
import { runMember, type MemberOutcome } from '../orchestration/members.ts';
import { mergeCopy, placeFor } from '../orchestration/solo-copy.ts';
import { publish, type MemberResult, type Seat, type Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import { assess, recordAssessment } from './assess.ts';
import { dependencyOrder } from './graph.ts';
import { landedPieces, runPiece, type PieceSite } from './piece-run.ts';
import { integratorSection } from './prompts.ts';
import { coordinatorMode, mayCoordinate } from './shadow.ts';
import type { Coordination } from './state.ts';
import { writePieceList } from './turn.ts';
import { builderEnvFor, projectSettings } from './builder-env.ts';

const BUILDS_IN_PIECES = new Set(['first', 'retry']);

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

async function integratorSeat(s: Session, coordination: Coordination): Promise<Seat> {
  const used = await usedNames(s.deps.db, s.taskId!, 'integrator');
  const name = used[0] ?? nextCrewName('integrator', used);
  return {
    role: 'integrator',
    name,
    resumeKey: `${s.taskId}:integrator`,
    prompt: null,
    route: {
      guard: { coordinated: true, owned: null },
      builderEnv: builderEnvFor(coordination.builderEnv, 1, name),
    },
  };
}

async function engage(s: Session): Promise<void> {
  const assessment = await assess(s);
  await recordAssessment(s, assessment, false);
  if (!assessment.engagement.engage) return;
  const root = s.input.projectRoots[0]!;
  const written = await writePieceList(s, assessment);
  s.coordination = {
    list: written.ok ? written.value.list : null,
    fallback: written.ok ? null : written.reason,
    owned: written.ok ? written.value.owned : new Map(),
    builderEnv: (await projectSettings(s.deps.db, s.lease.runId)).builderEnv,
    names: written.ok ? written.value.names : new Map(),
    scoutNotes: [],
    violations: 0,
    integrated: false,
    integrator: null,
    base: await treeOf(s, root),
  };
  await publish(s);
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
  const integration = coordination.list?.integration;
  if (!integration || coordination.integrated) return null;
  const prompt = `${integratorSection(integration, landedPieces(coordination))}\n\n## Request\n${s.input.userRequest}`;
  const { result } = await runMember(s, action, await site.place(), {
    seat: { ...s.integrator, prompt },
  });
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
  let spawn = action;
  let last: MemberResult | null = null;
  for (const piece of dependencyOrder(coordination.list!.pieces)) {
    const current = coordination.list!.pieces.find((candidate) => candidate.key === piece.key)!;
    if (current.status === 'landed' || current.status === 'skipped') continue;
    if (stopped(s)) break;
    const outcome = await runPiece(s, spawn, current, coordination, site);
    spawn = { ...action, escalate: false };
    coordination.list = await pieceListById(s.deps.db, coordination.list!.id);
    last = outcome.result;
    if (!outcome.landed) return { result: outcome.result };
  }
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

export async function coordinatedBuild(s: Session, action: Spawn): Promise<MemberOutcome | null> {
  const mode = coordinatorMode(s);
  if (action.role !== 'builder' || (mode !== 'in_order' && mode !== 'parallel')) return null;
  if (action.reason === 'first' && !s.coordination && mayCoordinate(s)) await engage(s);
  const coordination = s.coordination;
  if (!coordination?.list || !BUILDS_IN_PIECES.has(action.reason)) return null;
  return buildInPieces(s, action, coordination);
}
