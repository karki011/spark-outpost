import type { TaskPiece } from '@spark-outpost/contracts';
import { COORD_OWNERSHIP_STRIKES } from '../advisor/policy.ts';
import { pieceListById } from '../persistence/pieces.ts';
import { providerIssues } from '../persistence/provider-health.ts';
import type { MemberResult, Session } from '../orchestration/session.ts';
import { cleanupCopies } from '../orchestration/solo-copy.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import { projectSettings } from './builder-env.ts';
import { copySite, dropCopy, openCopies } from './group.ts';
import { runPiece, type PieceSite } from './piece-run.ts';
import { runReadySet, type PieceEnd } from './schedule.ts';
import { attributeShared, sharedBase, sharedSite } from './shared-landing.ts';
import type { Coordination } from './state.ts';

export interface PiecesRun {
  last: MemberResult | null;
  failure: MemberResult | null;
}

interface PieceGroup {
  limit: number;
  site(piece: TaskPiece, slot: number): Promise<PieceSite>;
  landed(piece: TaskPiece): Promise<void>;
  close(): Promise<void>;
}

const LIMITED = new Set(['rate_limit', 'usage_limit']);

export async function pieceSlots(s: Session): Promise<number> {
  const { slots } = await projectSettings(s.deps.db, s.lease.runId);
  const issues = await providerIssues(s.deps.db, s.input.workspaceId);
  const limited = issues.some(
    (issue) => issue.provider === s.input.provider && LIMITED.has(issue.kind),
  );
  return limited ? 1 : slots;
}

function cutByBudget(s: Session): boolean {
  return s.budgetHit !== null && s.control.reason() === null;
}

function stopped(s: Session): boolean {
  return s.control.signal.aborted || s.budgetHit !== null;
}

function inOrderGroup(site: PieceSite): PieceGroup {
  return {
    limit: 1,
    site: async () => site,
    landed: async () => undefined,
    close: async () => undefined,
  };
}

async function placedGroup(s: Session, coordination: Coordination): Promise<PieceGroup> {
  const building = coordination.list!.pieces.filter((piece) => !piece.research);
  const base = building.some((piece) => piece.placement === 'shared')
    ? await sharedBase(s, coordination)
    : null;
  const copies = building.some((piece) => piece.placement === 'worktree')
    ? await openCopies(s)
    : null;
  let attributed = Promise.resolve();
  return {
    limit: await pieceSlots(s),
    site: async (piece, slot) =>
      piece.placement === 'worktree'
        ? copySite(s, coordination, copies!, piece, slot)
        : sharedSite(coordination, base!.root, piece, slot),
    landed: async (piece) => {
      if (piece.placement === 'worktree') await dropCopy(s, copies!, piece.key);
      if (!base) return;
      attributed = attributed.then(() => attributeShared(s, coordination));
      await attributed;
    },
    close: () => (!copies || cutByBudget(s) ? Promise.resolve() : cleanupCopies(s)),
  };
}

async function openGroup(
  s: Session,
  coordination: Coordination,
  inOrder: PieceSite,
): Promise<PieceGroup> {
  if (coordination.list!.placement === 'in_order') return inOrderGroup(inOrder);
  return placedGroup(s, coordination);
}

function withAgentSlot<T>(s: Session, work: () => Promise<T>): Promise<T> {
  return s.deps.agentSlots ? s.deps.agentSlots.run(work) : work();
}

export async function runPieces(
  s: Session,
  action: Spawn,
  coordination: Coordination,
  inOrder: PieceSite,
): Promise<PiecesRun> {
  const list = coordination.list!;
  const group = await openGroup(s, coordination, inOrder);
  const outcome: PiecesRun = { last: null, failure: null };
  let spawn = action;
  const settled = list.pieces
    .filter((piece) => piece.status === 'landed' || piece.status === 'skipped')
    .map((piece) => piece.key);
  try {
    await runReadySet(list.pieces, {
      limit: group.limit,
      narrowed: () => coordination.violations >= COORD_OWNERSHIP_STRIKES,
      settled: new Set(settled),
      stopped: () => stopped(s),
      run: async (piece, slot): Promise<PieceEnd> => {
        const current = coordination.list!.pieces.find((item) => item.key === piece.key)!;
        if (current.status === 'skipped') return 'skipped';
        const next: Spawn =
          current.attempts === 0 && spawn.reason === 'resume'
            ? { ...spawn, reason: 'first' }
            : spawn;
        spawn = { ...action, escalate: false };
        const site = current.research ? inOrder : await group.site(current, slot);
        const ran = await withAgentSlot(s, () => runPiece(s, next, current, coordination, site));
        coordination.list = await pieceListById(s.deps.db, list.id);
        if (ran.skipped) return 'skipped';
        outcome.last = ran.result;
        if (!ran.landed) {
          outcome.failure ??= ran.result;
          return 'failed';
        }
        await group.landed(current);
        return 'landed';
      },
    });
  } finally {
    await group.close();
  }
  return outcome;
}
