import type { TaskPiece } from '@spark-outpost/contracts';
import { pieceListById } from '../persistence/pieces.ts';
import { providerIssues } from '../persistence/provider-health.ts';
import type { MemberResult, Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import { projectSettings } from './builder-env.ts';
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
  landed(): Promise<void>;
}

const LIMITED = new Set(['rate_limit', 'usage_limit']);

async function pieceSlots(s: Session): Promise<number> {
  const { slots } = await projectSettings(s.deps.db, s.lease.runId);
  const issues = await providerIssues(s.deps.db, s.input.workspaceId);
  const limited = issues.some(
    (issue) => issue.provider === s.input.provider && LIMITED.has(issue.kind),
  );
  return limited ? 1 : slots;
}

function stopped(s: Session): boolean {
  return s.control.signal.aborted;
}

function inOrderGroup(site: PieceSite): PieceGroup {
  return {
    limit: 1,
    site: async () => site,
    landed: async () => undefined,
  };
}

async function sharedGroup(s: Session, coordination: Coordination): Promise<PieceGroup> {
  const base = await sharedBase(s, coordination);
  let attributed = Promise.resolve();
  return {
    limit: await pieceSlots(s),
    site: async (piece, slot) => sharedSite(coordination, base.root, piece, slot),
    landed: async () => {
      attributed = attributed.then(() => attributeShared(s, coordination));
      await attributed;
    },
  };
}

async function openGroup(
  s: Session,
  coordination: Coordination,
  inOrder: PieceSite,
): Promise<PieceGroup> {
  if (coordination.list!.placement === 'in_order') return inOrderGroup(inOrder);
  return sharedGroup(s, coordination);
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
  await runReadySet(list.pieces, {
    limit: group.limit,
    settled: new Set(settled),
    stopped: () => stopped(s),
    run: async (piece, slot): Promise<PieceEnd> => {
      const current = coordination.list!.pieces.find((item) => item.key === piece.key)!;
      if (current.status === 'skipped') return 'skipped';
      const next = spawn;
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
      await group.landed();
      return 'landed';
    },
  });
  return outcome;
}
