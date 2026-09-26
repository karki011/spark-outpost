import { failingChecks, type CheckBody } from '@spark-outpost/contracts';
import { handOverSession } from '../persistence/provider-sessions.ts';
import { gitDiffBetween, workingTree } from '../projects/snapshot.ts';
import { agentKey } from '../workflow/session-decision.ts';
import { runChecks } from './checks.ts';
import { checkFailureText, checkFixFollowUp } from './context.ts';
import { reviewWanted } from './depth.ts';
import { resumeKeyFor, runMember, type MemberOutcome, type Place } from './members.ts';
import { ReviewQueue } from './reviews.ts';
import type { MemberResult, Session } from './session.ts';
import { spanOf } from './spans.ts';
import type { FlowAction, Spawn } from './transitions.ts';

export const CHECK_FIXES = 1;

export interface Landing {
  result: MemberResult;
  ticked: number[];
  checks: CheckBody | null;
}

export interface LandingSite {
  cwd: string;
  before: string | null;
  place: Place | null;
  copy: string | null;
  copyRunId: string | null;
}

export async function treeOf(s: Session, cwd: string): Promise<string | null> {
  if (!s.git) return null;
  return workingTree(cwd).catch(() => null);
}

async function changedSince(site: LandingSite): Promise<boolean> {
  if (site.before === null) return true;
  const after = await workingTree(site.cwd).catch(() => null);
  return after === null || after !== site.before;
}

async function handOverInPlace(s: Session, name: string): Promise<void> {
  const key = resumeKeyFor(s, 'builder', name);
  if (!key) return;
  await handOverSession(
    s.deps.db,
    s.input.identity.threadId,
    agentKey(s.input.mode, null),
    agentKey(s.input.mode, key),
  );
}

async function fix(
  s: Session,
  spawn: Spawn,
  last: MemberResult,
  body: CheckBody,
  site: LandingSite,
): Promise<MemberResult> {
  if (last.inPlace) await handOverInPlace(s, last.name);
  const failures = checkFailureText(failingChecks(body));
  const place: Place | null =
    site.place && site.copyRunId && site.copy
      ? { ...site.place, reuse: { runId: site.copyRunId, branch: site.copy } }
      : site.place;
  const outcome = await runMember(
    s,
    {
      role: 'builder',
      stepIndex: spawn.stepIndex,
      carry: spawn.carry,
      escalate: false,
      note: null,
      reason: 'fix',
      checkFailures: failures,
      followUp: checkFixFollowUp(failures),
    },
    place,
  );
  return outcome.result;
}

function reviewKey(spawn: Spawn): string {
  return spanOf(spawn).join(',');
}

async function queueReview(
  s: Session,
  spawn: Spawn,
  result: MemberResult,
  site: LandingSite,
  checks: CheckBody | null,
): Promise<void> {
  if (!reviewWanted(s.flow) || s.flow.reviewed || site.before === null) return;
  const after = await workingTree(site.cwd).catch(() => null);
  if (!after) return;
  const diff = await gitDiffBetween(site.cwd, site.before, after).catch(() => null);
  if (!diff || diff.stats.length === 0) return;
  s.reviews ??= new ReviewQueue(s);
  s.reviews.enqueue({
    key: reviewKey(spawn),
    subject: { name: result.name, steps: spanOf(spawn) },
    files: diff.stats,
    patch: diff.patch,
    checks,
  });
}

export async function land(
  s: Session,
  spawn: Spawn,
  first: MemberResult,
  site: LandingSite,
): Promise<Landing> {
  const ticked = new Set(first.ticked);
  if (first.role !== 'builder' || first.outcome !== 'succeeded') {
    return { result: first, ticked: [...ticked], checks: null };
  }
  if (!(await changedSince(site))) return { result: first, ticked: [...ticked], checks: null };
  const target = (result: MemberResult) => ({
    runId: result.runId,
    name: result.name,
    cwd: site.cwd,
    copy: site.copy,
  });
  let last = first;
  let checks = await runChecks(s, target(last));
  for (let fixes = 0; checks?.status === 'failed' && fixes < CHECK_FIXES; fixes += 1) {
    last = await fix(s, spawn, last, checks, site);
    last.ticked.forEach((index) => ticked.add(index));
    if (last.outcome !== 'succeeded') return { result: last, ticked: [...ticked], checks };
    checks = await runChecks(s, target(last));
  }
  await queueReview(s, spawn, last, site, checks);
  return { result: last, ticked: [...ticked], checks };
}

export async function buildAndLand(
  s: Session,
  action: Extract<FlowAction, { type: 'spawn' }>,
): Promise<MemberOutcome> {
  const root = s.input.projectRoots[0];
  const lands = action.role === 'builder' && root !== undefined;
  const before = lands ? await treeOf(s, root) : null;
  const outcome: MemberOutcome = await runMember(s, action);
  if (!lands || outcome.result.outcome !== 'succeeded' || s.budgetHit) return outcome;
  const landed = await land(s, action, outcome.result, {
    cwd: root,
    before,
    place: null,
    copy: null,
    copyRunId: null,
  });
  return { ...outcome, result: { ...landed.result, ticked: landed.ticked } };
}
