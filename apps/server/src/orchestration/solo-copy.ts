import { buildsInWorktree } from '../agents/acp/agents.ts';
import { commitTree } from '../projects/snapshot.ts';
import { getWorktree } from '../persistence/worktrees.ts';
import { cleanupCopies, copyFor, finishCopy, prepareCopies } from './group.ts';
import { land } from './land.ts';
import { runMember, type MemberOutcome, type Place } from './members.ts';
import { mergeCopies } from './merge.ts';
import { markPlanSteps } from './plan-progress.ts';
import type { Session } from './session.ts';
import { spanOf } from './spans.ts';
import type { FlowAction } from './transitions.ts';

type BuilderSpawn = Extract<FlowAction, { type: 'spawn' }>;

export function buildsInCopy(s: Session, action: BuilderSpawn): boolean {
  return (
    action.role === 'builder' &&
    s.git &&
    s.input.mode === 'do' &&
    buildsInWorktree(s.input.provider, s.flow.level)
  );
}

export async function buildInCopy(s: Session, action: BuilderSpawn): Promise<MemberOutcome> {
  s.groups += 1;
  const copies = await prepareCopies(s, `solo${s.groups}`);
  const place: Place = { copy: copyFor(s, copies) };
  const steps = spanOf(action);
  try {
    await markPlanSteps(s, steps, 'in_progress', s.lease.runId);
    const outcome = await runMember(s, action, place);
    const first = outcome.result;
    if (first.outcome !== 'succeeded' || s.budgetHit) return outcome;
    const record = await getWorktree(s.deps.db, first.runId);
    if (!record) return outcome;
    const landed = await land(s, action, first, {
      cwd: record.path,
      before: await commitTree(record.repoRoot, record.baseCommit),
      place,
      copy: first.name,
      copyRunId: record.runId,
      review: 'now',
    });
    const result = { ...landed.result, ticked: landed.ticked, copyRunId: record.runId };
    if (result.outcome !== 'succeeded') return { ...outcome, result };
    const finished = await finishCopy(s, {
      stepIndex: action.stepIndex,
      steps,
      role: 'builder',
      result,
      reviewed: landed.reviewed,
    });
    const merged = await mergeCopies(s, finished ? [finished] : []);
    const mergedOutcome = merged.results.get(action.stepIndex) ?? 'succeeded';
    const final = merged.stopped ? 'cancelled' : mergedOutcome;
    return { ...outcome, result: { ...result, outcome: final } };
  } finally {
    await cleanupCopies(s);
  }
}
