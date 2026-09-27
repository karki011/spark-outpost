import { failingChecks, type CheckBody } from '@spark-outpost/contracts';
import { CHECK_FIXES } from '../advisor/policy.ts';
import { awaitDepsPrep } from '../projects/deps-prep.ts';
import { workingTree } from '../projects/snapshot.ts';
import { runChecks } from './checks.ts';
import { checkFailureText } from './context.ts';
import { runMember, type MemberOutcome, type Place } from './members.ts';
import { checkLines } from './reviews.ts';
import type { MemberResult, Session } from './session.ts';
import type { FlowAction } from './transitions.ts';

export interface LandingSite {
  cwd: string;
  before: string | null;
  place: Place | null;
}

export interface Landing {
  result: MemberResult;
  checks: CheckBody | null;
  changed: boolean;
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

async function fix(s: Session, body: CheckBody, site: LandingSite): Promise<MemberResult> {
  const outcome = await runMember(
    s,
    { role: 'builder', reason: 'fix', escalate: false, note: null },
    site.place,
    { checkFailures: checkFailureText(failingChecks(body)) },
  );
  return outcome.result;
}

export async function checkAndFix(
  s: Session,
  first: MemberResult,
  site: LandingSite,
): Promise<Landing> {
  if (first.role !== 'builder' || first.outcome !== 'succeeded' || !(await changedSince(site))) {
    return { result: first, checks: null, changed: false };
  }
  const target = (result: MemberResult) => ({
    runId: result.runId,
    name: result.name,
    cwd: site.cwd,
    copy: site.place ? result.name : null,
  });
  let last = first;
  const copyRunId = site.place?.reuse?.runId ?? null;
  await awaitDepsPrep(s.deps.db, copyRunId);
  let checks = await runChecks(s, target(last));
  for (let fixes = 0; checks?.status === 'failed' && fixes < CHECK_FIXES; fixes += 1) {
    last = await fix(s, checks, site);
    if (last.outcome !== 'succeeded') break;
    checks = await runChecks(s, target(last));
  }
  s.checkLines = checkLines(checks);
  return { result: last, checks, changed: true };
}

export async function buildAndLand(
  s: Session,
  action: Extract<FlowAction, { type: 'spawn' }>,
): Promise<MemberOutcome> {
  const root = s.input.projectRoots[0];
  const lands = action.role === 'builder' && root !== undefined;
  const before = lands ? await treeOf(s, root) : null;
  const outcome = await runMember(s, action);
  if (!lands || outcome.result.outcome !== 'succeeded' || s.budgetHit) return outcome;
  const landed = await checkAndFix(s, outcome.result, { cwd: root, before, place: null });
  return { ...outcome, result: landed.result };
}
