import { matchesGlob } from 'node:path';
import { looksLikePlan } from '../../../packages/contracts/src/plans.ts';
import { testsGreen, type TestCounts } from '../../bench/verify.ts';
import type { BaseArm } from '../scenario-types.ts';
import type { ActionKind, Behavior, DaySession } from './sessions.ts';

export interface Evidence {
  arm: BaseArm;
  changed: string[];
  reply: string;
  reviewText: string;
  clarifyCard: boolean;
  planCard: boolean;
  planSaved: 'auto' | 'offer' | 'manual' | 'none' | null;
  hidden: TestCounts | null;
  suite: TestCounts | null;
  timedOut: boolean;
  error: string | null;
  originalUntouched: boolean | null;
  roles: string[];
  checksRan: number;
  builderPlanLoaded: boolean | null;
  criticPlanLoaded: boolean | null;
  topTier: boolean | null;
  worktrees: number;
  cardFirst: boolean | null;
  builders: number;
  parallelBuilders: number;
  handoff: boolean | null;
  resumed: boolean | null;
  draftPr: { opened: boolean; draft: boolean; branchPushed: boolean } | null;
  shipAvailable: boolean | null;
  pushedBranches: string[];
  interventions: Intervention[];
  clicks: number;
}

export interface Intervention {
  kind: 'paste' | 'checkpoint' | 'save-plan' | 'clarify' | 'manual-pr' | 'manual-push';
  text: string;
}

export interface CheckResult {
  id: string;
  ok: boolean | null;
  detail: string;
}

export interface SessionScore {
  kind: ActionKind;
  checks: CheckResult[];
  behaviors: CheckResult[];
  passed: boolean;
  repairMinutes: number;
  userMinutes: number;
}

export interface Rates {
  hourlyUsd: number;
  interventionMinutes: number;
}

export const DEFAULT_RATES: Rates = { hourlyUsd: 100, interventionMinutes: 1 };

const LIST_ITEM = /^\s{0,3}(?:\d+[.)]|[-*+])\s+\S/;
const HEADING = /^\s{0,3}#{1,4}\s+\S/;
const OPTION_WORDS =
  /\b(?:options?|alternatives?|approach(?:es)?|trade-?offs?|pros|cons|ways\s+(?:to|we\s+could))\b|^\s*(?:[-*+]\s+)?(?:\*\*)?(?:pro|con)s?(?:\*\*)?\s*:/im;

const TABLE_ROW = /^\s*\|(?!\s*:?-{3,}).+\|\s*$/;

function listItems(text: string): number {
  const lines = text.split('\n');
  const listed = lines.filter((line) => LIST_ITEM.test(line) || HEADING.test(line)).length;
  const rows = lines.filter((line) => TABLE_ROW.test(line)).length;
  return Math.max(listed, rows - 1);
}

export function asksBack(reply: string): boolean {
  const text = reply.trim();
  if (!text.includes('?') || text.length > 1_200) return false;
  const questions = text.split(/(?<=[?.!])\s+/).filter((sentence) => sentence.trim().endsWith('?'));
  const offers = questions.filter((sentence) =>
    /\b(?:want me to|shall i|should i|would you like me to)\b/i.test(sentence),
  );
  return questions.length > offers.length;
}

export function classify(evidence: Evidence): ActionKind {
  if (evidence.changed.length > 0) return 'build';
  if (evidence.clarifyCard) return 'clarify';
  if (evidence.planCard) return 'plan';
  if (asksBack(evidence.reply)) return 'clarify';
  if (OPTION_WORDS.test(evidence.reply) && listItems(evidence.reply) >= 2) return 'options';
  if (evidence.planSaved === 'auto' || looksLikePlan(evidence.reply)) return 'plan';
  return 'answer';
}

const ACCEPTED: Record<ActionKind, readonly ActionKind[]> = {
  answer: ['answer', 'options', 'plan'],
  options: ['options'],
  plan: ['plan'],
  build: ['build'],
  clarify: ['clarify'],
};

export function kindMatches(expected: ActionKind, actual: ActionKind): boolean {
  return ACCEPTED[expected].includes(actual);
}

const counts = (value: TestCounts | null) =>
  value ? `${value.pass}/${value.tests} passed` : 'no result';

function outcomeChecks(session: DaySession, evidence: Evidence, kind: ActionKind): CheckResult[] {
  const { expect } = session;
  const checks: CheckResult[] = [
    {
      id: 'kind',
      ok: kindMatches(expect.kind, kind),
      detail: `expected ${expect.kind}, got ${kind}`,
    },
  ];
  if (evidence.error || evidence.timedOut) {
    checks.push({
      id: 'finished',
      ok: false,
      detail: evidence.timedOut ? 'timed out' : (evidence.error ?? ''),
    });
  }
  if (expect.kind !== 'build') {
    checks.push({
      id: 'noEdits',
      ok: evidence.changed.length === 0,
      detail: evidence.changed.length === 0 ? 'no files changed' : evidence.changed.join(', '),
    });
  }
  for (const pattern of expect.answer ?? []) {
    checks.push({ id: 'answer', ok: pattern.test(evidence.reply), detail: String(pattern) });
  }
  for (const [index, group] of (expect.review ?? []).entries()) {
    const ok = group.every((pattern) => pattern.test(evidence.reviewText));
    checks.push({ id: `review-${index + 1}`, ok, detail: group.map(String).join(' and ') });
  }
  if (expect.kind === 'options') {
    const items = listItems(evidence.reply);
    checks.push({ id: 'options', ok: items >= 2, detail: `${items} options or headings` });
  }
  if (expect.hidden) {
    checks.push({ id: 'hidden', ok: testsGreen(evidence.hidden), detail: counts(evidence.hidden) });
    checks.push({ id: 'suite', ok: testsGreen(evidence.suite), detail: counts(evidence.suite) });
  }
  if (expect.allowed) {
    const outside = evidence.changed.filter(
      (file) => !expect.allowed!.some((pattern) => matchesGlob(file, pattern)),
    );
    checks.push({
      id: 'scope',
      ok: outside.length === 0,
      detail: outside.length === 0 ? 'inside the task' : `outside: ${outside.join(', ')}`,
    });
  }
  if (evidence.originalUntouched !== null) {
    checks.push({
      id: 'readOnly',
      ok: evidence.originalUntouched,
      detail: evidence.originalUntouched ? 'original untouched' : 'THE ORIGINAL REPO CHANGED',
    });
  }
  if (session.ship && evidence.arm === 'harness') {
    const pr = evidence.draftPr;
    checks.push({
      id: 'draftPr',
      ok:
        evidence.shipAvailable === false
          ? null
          : Boolean(pr?.opened && pr.draft && pr.branchPushed),
      detail:
        evidence.shipAvailable === false
          ? 'Ship is not in this build yet'
          : pr?.opened
            ? `draft ${pr.draft}, branch pushed ${pr.branchPushed}`
            : 'no PR opened on the fake GitHub',
    });
  }
  return checks;
}

function yesNo(
  ok: boolean | null,
  yes: string,
  no: string,
  missing = 'not observed',
): CheckResult['detail'] {
  return ok === null ? missing : ok ? yes : no;
}

export function behaviorChecks(session: DaySession, evidence: Evidence): CheckResult[] {
  if (evidence.arm !== 'harness') return [];
  const has = (role: string) => evidence.roles.includes(role);
  const table: Record<Behavior, () => CheckResult> = {
    noCrew: () => {
      const ok = !has('architect') && !has('critic') && !evidence.planCard;
      return { id: 'noCrew', ok, detail: ok ? 'direct' : `crew: ${evidence.roles.join(', ')}` };
    },
    planCard: () => ({
      id: 'planCard',
      ok: evidence.planCard && evidence.planSaved !== 'none',
      detail: `plan card ${evidence.planCard ? 'shown' : 'missing'}, saved ${evidence.planSaved ?? 'n/a'}`,
    }),
    planLoaded: () => {
      const ok =
        evidence.builderPlanLoaded === null
          ? null
          : evidence.builderPlanLoaded && evidence.criticPlanLoaded !== false;
      return {
        id: 'planLoaded',
        ok,
        detail: `Builder ${yesNo(evidence.builderPlanLoaded, 'had', 'lacked', 'did not run')} the plan, Critic ${yesNo(evidence.criticPlanLoaded, 'had', 'lacked', 'did not run')} it`,
      };
    },
    criticRan: () => ({
      id: 'criticRan',
      ok: has('critic'),
      detail: has('critic') ? 'Critic ran' : 'no Critic',
    }),
    checksRan: () => ({
      id: 'checksRan',
      ok: evidence.checksRan > 0,
      detail: `${evidence.checksRan} check rounds`,
    }),
    topTier: () => ({
      id: 'topTier',
      ok: evidence.topTier,
      detail: yesNo(evidence.topTier, 'top tier', 'not top tier'),
    }),
    worktree: () => ({
      id: 'worktree',
      ok: evidence.worktrees > 0,
      detail: `${evidence.worktrees} worktrees`,
    }),
    cardFirst: () => ({
      id: 'cardFirst',
      ok: evidence.cardFirst,
      detail: yesNo(evidence.cardFirst, 'card before the first edit', 'edits before any card'),
    }),
    oneBuilder: () => ({
      id: 'oneBuilder',
      ok: evidence.builders >= 1 && evidence.parallelBuilders === 0,
      detail: `${evidence.builders} Builders, ${evidence.parallelBuilders} in parallel`,
    }),
    handoff: () => ({
      id: 'handoff',
      ok: evidence.handoff ? true : null,
      detail: evidence.handoff ? 'context handed off' : 'did not trigger',
    }),
    resumed: () => ({
      id: 'resumed',
      ok: evidence.resumed,
      detail: yesNo(evidence.resumed, 'continued the session', 'started over'),
    }),
    draftPr: () => ({
      id: 'draftPr',
      ok: evidence.shipAvailable === false ? null : Boolean(evidence.draftPr?.opened),
      detail: evidence.shipAvailable === false ? 'Ship not in this build' : 'see outcome',
    }),
  };
  return session.behaviors.map((behavior) => table[behavior]());
}

export function scoreSession(
  session: DaySession,
  evidence: Evidence,
  rates: Rates = DEFAULT_RATES,
): SessionScore {
  const kind = classify(evidence);
  const checks = outcomeChecks(session, evidence, kind);
  const passed = checks.every((check) => check.ok !== false);
  const repairMinutes = passed ? 0 : session.repairMinutes;
  return {
    kind,
    checks,
    behaviors: behaviorChecks(session, evidence),
    passed,
    repairMinutes,
    userMinutes: repairMinutes + evidence.interventions.length * rates.interventionMinutes,
  };
}

export interface ArmSummary {
  arm: BaseArm;
  sessions: number;
  passes: number;
  passRate: number;
  spendUsd: number;
  costPerPassUsd: number | null;
  interventions: number;
  userMinutes: number;
  userUsd: number;
  trueCostUsd: number;
  trueCostPerPassUsd: number | null;
  wallMs: number;
}

export interface ScoredRun {
  arm: BaseArm;
  score: SessionScore;
  costUsd: number;
  wallMs: number;
  interventions: number;
}

export function summarise(
  arm: BaseArm,
  runs: readonly ScoredRun[],
  rates: Rates = DEFAULT_RATES,
): ArmSummary {
  const mine = runs.filter((run) => run.arm === arm);
  const passes = mine.filter((run) => run.score.passed).length;
  const spendUsd = mine.reduce((sum, run) => sum + run.costUsd, 0);
  const userMinutes = mine.reduce((sum, run) => sum + run.score.userMinutes, 0);
  const userUsd = (userMinutes / 60) * rates.hourlyUsd;
  const trueCostUsd = spendUsd + userUsd;
  return {
    arm,
    sessions: mine.length,
    passes,
    passRate: mine.length === 0 ? 0 : passes / mine.length,
    spendUsd,
    costPerPassUsd: passes === 0 ? null : spendUsd / passes,
    interventions: mine.reduce((sum, run) => sum + run.interventions, 0),
    userMinutes,
    userUsd,
    trueCostUsd,
    trueCostPerPassUsd: passes === 0 ? null : trueCostUsd / passes,
    wallMs: mine.reduce((sum, run) => sum + run.wallMs, 0),
  };
}

export function rank(summaries: readonly ArmSummary[]): ArmSummary[] {
  const perPass = (summary: ArmSummary) => summary.trueCostPerPassUsd ?? Number.POSITIVE_INFINITY;
  return [...summaries].sort(
    (a, b) => b.passRate - a.passRate || perPass(a) - perPass(b) || a.arm.localeCompare(b.arm),
  );
}
