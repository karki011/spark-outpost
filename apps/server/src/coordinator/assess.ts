import { modeNeedsWorktree, type PlanDocument } from '@spark-outpost/contracts';
import { COORD_POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { latestApprovedPlan } from '../persistence/plan-documents.ts';
import { outlinePlan } from '../plans/agreed-block.ts';
import { namedFiles } from '../orchestration/context.ts';
import { builderFacts } from '../orchestration/member-routes.ts';
import { routeBuilder } from '../orchestration/routing.ts';
import { repoBusy } from '../orchestration/solo-copy.ts';
import type { Session } from '../orchestration/session.ts';
import { engagement, likelyFiles, type Engagement } from './engage.ts';
import { planSteps, type PlanStep } from './plan-coverage.ts';
import {
  placePieces,
  type PlaceablePiece,
  type Placement,
  type PlacementFacts,
} from './placement.ts';
import { budgetFor, lineCounter } from './project-facts.ts';
import { sizeEstimate, type LineCount } from './size.ts';

export interface Assessment {
  engagement: Engagement;
  placement: Placement | null;
  plan: Pick<PlanDocument, 'id' | 'version'> | null;
  planItems: string[];
  planSteps: PlanStep[];
  likelyFiles: number;
  sizeEstimate: number;
  budgetTokens: number;
}

function planPieces(items: readonly string[], lines: LineCount): PlaceablePiece[] {
  const pieces: PlaceablePiece[] = [];
  items.forEach((item, index) => {
    const owns = namedFiles([item]);
    const dependsOn = pieces
      .filter((earlier) => earlier.owned.paths.some((file) => owns.includes(file)))
      .map((earlier) => earlier.key);
    pieces.push({
      key: `I${index + 1}`,
      owned: { paths: owns, globs: [] },
      dependsOn,
      sizeEstimate: sizeEstimate({ owns, reads: [] }, lines),
      size: 'M',
      research: owns.length === 0,
    });
  });
  return pieces;
}

export async function placementFacts(s: Session): Promise<PlacementFacts> {
  const root = s.input.projectRoots[0]!;
  return {
    git: s.git,
    repoBusy: s.git ? await repoBusy(s.deps.db, s.lease.runId, root) : false,
    destructive: s.facts.destructive,
    skipsGate: modeNeedsWorktree(s.input.provider, s.input.agentMode),
    wholeProjectChecks: (s.checks?.commands.length ?? 0) > 0,
    splitWorthIt: null,
    sameFolder: null,
  };
}

async function awaitScan(s: Session) {
  const outcome = await (s.scan ?? Promise.resolve(null));
  return outcome?.report ?? null;
}

export async function assess(s: Session): Promise<Assessment> {
  const root = s.input.projectRoots[0]!;
  const report = await awaitScan(s);
  const plan = await latestApprovedPlan(s.deps.db, s.input.identity.threadId);
  const planItems = plan ? outlinePlan(plan.body).open : [];
  const steps = plan ? planSteps(plan.body) : [];
  const likely = likelyFiles(report?.candidates ?? []);
  const known = new Map(
    (report?.candidates ?? []).flatMap((file) =>
      file.lines === null ? [] : [[file.path, file.lines] as const],
    ),
  );
  const planned = namedFiles(planItems);
  const lines = await lineCounter(root, [...planned, ...likely.map((file) => file.path)], known);
  const owns = [...new Set([...likely.map((file) => file.path), ...planned])];
  const size = sizeEstimate({ owns, reads: [] }, lines);
  const pick = routeBuilder(s.route, builderFacts(s), s.intake.body.jev?.tier ?? null).pick;
  const budgetTokens = budgetFor(pick);
  const engaged = engagement({
    request: s.input.userRequest,
    planItems,
    likely,
    sizeEstimate: size,
    budgetTokens,
  });
  const pieces = planPieces(planItems, lines);
  const placement = pieces.length > 1 ? placePieces(pieces, await placementFacts(s)) : null;
  return {
    engagement: engaged,
    placement,
    plan: plan ? { id: plan.id, version: plan.version } : null,
    planItems,
    planSteps: steps,
    likelyFiles: likely.length,
    sizeEstimate: size,
    budgetTokens,
  };
}

function summaryOf(assessment: Assessment, shadow: boolean): string {
  const { engagement: engaged, placement } = assessment;
  const prefix = shadow ? 'Coordinator (shadow)' : 'Coordinator';
  if (!engaged.engage) return `${prefix}: one Builder; ${engaged.detail}`;
  const placed = placement ? `; would place ${placement.placement}: ${placement.reason}` : '';
  return `${prefix}: engages (${engaged.reason}); ${engaged.detail}${placed}`;
}

export async function recordAssessment(
  s: Session,
  assessment: Assessment,
  shadow: boolean,
): Promise<void> {
  const { engagement: engaged, placement } = assessment;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'parallel',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: COORD_POLICY_VERSION,
    body: {
      summary: summaryOf(assessment, shadow),
      applied: 'rules',
      gate: null,
      jevError: null,
      jevModel: null,
      latencyMs: null,
      answer: {
        shadow,
        engage: engaged.engage,
        reason: engaged.reason,
        detail: engaged.detail,
        tooBigUnsure: engaged.tooBigUnsure,
        placement: placement?.placement ?? null,
        row: placement?.row ?? null,
        placementReason: placement?.reason ?? null,
        saving: placement ? Math.round(placement.saving * 100) / 100 : null,
        planVersion: assessment.plan?.version ?? null,
        planItems: assessment.planItems.length,
        likelyFiles: assessment.likelyFiles,
        sizeEstimate: assessment.sizeEstimate,
        budgetTokens: assessment.budgetTokens,
      },
    },
  });
}
