import { modeSkipsGate, type PlanDocument } from '@spark-outpost/contracts';
import { COORD_POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { latestApprovedPlan } from '../persistence/plan-documents.ts';
import { outlinePlan } from '../plans/agreed-block.ts';
import { builtSinceApproval } from '../plans/plan-turn.ts';
import { namedFiles } from '../orchestration/context.ts';
import { builderFacts } from '../orchestration/member-routes.ts';
import { routeBuilder } from '../orchestration/routing.ts';
import type { Session } from '../orchestration/session.ts';
import type { BuilderPlan } from './builder-jev.ts';
import { engagement, likelyFiles, type Engagement } from './engage.ts';
import { planSteps, type PlanStep } from './plan-coverage.ts';
import {
  placePieces,
  type PlaceablePiece,
  type Placement,
  type PlacementFacts,
} from './placement.ts';
import { budgetFor, lineCounter } from './project-facts.ts';
import { sizeEstimate } from './size.ts';

export interface Assessment {
  engagement: Engagement;
  placement: Placement | null;
  plan: Pick<PlanDocument, 'id' | 'version'> | null;
  planItems: string[];
  planSteps: PlanStep[];
  planBuilt: boolean;
  likelyFiles: number;
  sizeEstimate: number;
  budgetTokens: number;
}

function planPieces(items: readonly string[]): PlaceablePiece[] {
  return items.map((item, index) => ({
    key: `I${index + 1}`,
    research: namedFiles([item]).length === 0,
  }));
}

export function placementFacts(s: Session): PlacementFacts {
  return { git: s.git, skipsGate: modeSkipsGate(s.input.provider, s.input.agentMode) };
}

async function awaitScan(s: Session) {
  const outcome = await (s.scan ?? Promise.resolve(null));
  return outcome?.report ?? null;
}

export async function assess(s: Session): Promise<Assessment> {
  const root = s.input.projectRoots[0]!;
  const report = await awaitScan(s);
  const threadId = s.input.identity.threadId;
  const plan = await latestApprovedPlan(s.deps.db, threadId);
  const planBuilt = plan
    ? await builtSinceApproval(s.deps.db, threadId, plan, s.lease.runId)
    : false;
  const building = plan !== null && !planBuilt;
  const planItems = building ? outlinePlan(plan.body).open : [];
  const steps = building ? planSteps(plan.body) : [];
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
    followUpRound: s.input.followUpRound === true,
  });
  const pieces = planPieces(planItems);
  const placement = pieces.length > 1 ? placePieces(pieces, placementFacts(s)) : null;
  return {
    engagement: engaged,
    placement,
    plan: plan ? { id: plan.id, version: plan.version } : null,
    planItems,
    planSteps: steps,
    planBuilt,
    likelyFiles: likely.length,
    sizeEstimate: size,
    budgetTokens,
  };
}

function summaryOf(assessment: Assessment, shadow: boolean, plan: BuilderPlan | null): string {
  const { engagement: engaged, placement } = assessment;
  const prefix = shadow ? 'Coordinator (shadow)' : 'Coordinator';
  if (plan?.builders) {
    const built = plan.builders === 1 ? 'one Builder' : `engages with ${plan.builders} pieces`;
    return `${prefix}: ${plan.reason}; ${built}`;
  }
  const jev = plan ? `; ${plan.reason}` : '';
  if (!engaged.engage) return `${prefix}: one Builder; ${engaged.detail}${jev}`;
  const placed = placement ? `; would place ${placement.placement}: ${placement.reason}` : '';
  return `${prefix}: engages (${engaged.reason}); ${engaged.detail}${placed}${jev}`;
}

function buildersAnswer(plan: BuilderPlan) {
  const verdict = plan.verdict?.confident ? plan.verdict : null;
  return {
    applied: plan.builders === null ? 'rules' : 'jev',
    reason: plan.reason,
    asked: verdict?.asked ?? null,
    confidence: verdict?.confidence ?? null,
    builders: plan.builders,
    tasks: plan.tasks.map((task) => ({ key: task.key, text: task.title, files: task.owns })),
    groups: plan.groups,
  };
}

export async function recordAssessment(
  s: Session,
  assessment: Assessment,
  shadow: boolean,
  plan: BuilderPlan | null = null,
): Promise<void> {
  const { engagement: engaged, placement } = assessment;
  const call = plan?.call ?? null;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'parallel',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: plan?.status ?? 'not_asked',
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    policyVersion: COORD_POLICY_VERSION,
    body: {
      summary: summaryOf(assessment, shadow, plan),
      applied: plan?.builders ? 'jev' : 'rules',
      gate: null,
      jevError: call?.error ?? null,
      jevModel: call?.model ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: {
        shadow,
        engage: plan?.builders ? plan.builders > 1 : engaged.engage,
        reason: engaged.reason,
        detail: engaged.detail,
        tooBigUnsure: engaged.tooBigUnsure,
        placement: placement?.placement ?? null,
        placementReason: placement?.reason ?? null,
        planVersion: assessment.plan?.version ?? null,
        planBuilt: assessment.planBuilt,
        solo: engaged.solo,
        planItems: assessment.planItems.length,
        likelyFiles: assessment.likelyFiles,
        sizeEstimate: assessment.sizeEstimate,
        budgetTokens: assessment.budgetTokens,
        builders: plan ? buildersAnswer(plan) : null,
      },
      state: call?.asked?.state ?? null,
      questions: call?.asked ? Object.keys(call.asked.questions) : null,
      answers: call?.response?.answers ?? null,
    },
  });
}
