import { failingChecks, type CheckBody } from '@spark-outpost/contracts';
import { handOverSession } from '../persistence/provider-sessions.ts';
import { awaitDepsPrep } from '../projects/deps-prep.ts';
import { gitDiffBetween, workingTree } from '../projects/snapshot.ts';
import { agentKey } from '../workflow/session-decision.ts';
import { runChecks } from './checks.ts';
import { checkFailureText, checkFixFollowUp, type ReviewSubject } from './context.ts';
import { reviewWanted } from './depth.ts';
import { resumeKeyFor, runMember, type MemberOutcome, type Place } from './members.ts';
import { ReviewQueue } from './reviews.ts';
import type { MemberResult, Session } from './session.ts';
import { spanOf } from './spans.ts';
import type { FlowAction, Spawn } from './transitions.ts';

export const CHECK_FIXES = 1;

export const LANE_REVIEW_BYTES = 12_000;

export type ReviewTiming = 'now' | 'if_large';

export interface Landing {
  result: MemberResult;
  ticked: number[];
  checks: CheckBody | null;
  reviewed: boolean;
}

export interface LandingSite {
  cwd: string;
  before: string | null;
  place: Place | null;
  copy: string | null;
  copyRunId: string | null;
  review?: ReviewTiming;
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

export interface DiffReview {
  key: string;
  subject: ReviewSubject;
  cwd: string;
  before: string;
  paths?: readonly string[];
  checks: CheckBody | null;
  timing?: ReviewTiming;
}

export async function queueDiffReview(s: Session, review: DiffReview): Promise<boolean> {
  if (!reviewWanted(s.flow) || s.flow.reviewed) return false;
  const after = await workingTree(review.cwd).catch(() => null);
  if (!after) return false;
  const diff = await gitDiffBetween(review.cwd, review.before, after, review.paths).catch(
    () => null,
  );
  if (!diff || diff.stats.length === 0) return false;
  if (review.timing === 'if_large' && diff.patch.length <= LANE_REVIEW_BYTES) return false;
  s.reviews ??= new ReviewQueue(s);
  s.reviews.enqueue({
    key: review.key,
    subject: review.subject,
    files: diff.stats,
    patch: diff.patch,
    checks: review.checks,
  });
  return true;
}

type Checked = Omit<Landing, 'reviewed'>;

export async function land(
  s: Session,
  spawn: Spawn,
  first: MemberResult,
  site: LandingSite,
): Promise<Landing> {
  const checked = await checkAndFix(s, spawn, first, site);
  const landed = checked.result.role === 'builder' && checked.result.outcome === 'succeeded';
  if (!landed || site.before === null || !checked.changed) {
    return { ...checked, reviewed: false };
  }
  const reviewed = await queueDiffReview(s, {
    key: reviewKey(spawn),
    subject: { name: checked.result.name, steps: spanOf(spawn) },
    cwd: site.cwd,
    before: site.before,
    checks: checked.checks,
    timing: site.review ?? 'now',
  });
  return { ...checked, reviewed };
}

export async function checkAndFix(
  s: Session,
  spawn: Spawn,
  first: MemberResult,
  site: LandingSite,
): Promise<Checked & { changed: boolean }> {
  const ticked = new Set(first.ticked);
  if (first.role !== 'builder' || first.outcome !== 'succeeded') {
    return { result: first, ticked: [...ticked], checks: null, changed: false };
  }
  if (!(await changedSince(site))) {
    return { result: first, ticked: [...ticked], checks: null, changed: false };
  }
  const target = (result: MemberResult) => ({
    runId: result.runId,
    name: result.name,
    cwd: site.cwd,
    copy: site.copy,
  });
  let last = first;
  await awaitDepsPrep(s.deps.db, site.copyRunId);
  let checks = await runChecks(s, target(last));
  for (let fixes = 0; checks?.status === 'failed' && fixes < CHECK_FIXES; fixes += 1) {
    last = await fix(s, spawn, last, checks, site);
    last.ticked.forEach((index) => ticked.add(index));
    if (last.outcome !== 'succeeded') {
      return { result: last, ticked: [...ticked], checks, changed: true };
    }
    checks = await runChecks(s, target(last));
  }
  return { result: last, ticked: [...ticked], checks, changed: true };
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
