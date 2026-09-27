import type { AgentPick } from '@spark-outpost/contracts';
import { handOverSession } from '../persistence/provider-sessions.ts';
import { agentKey, settingsHash } from '../workflow/session-decision.ts';
import { planApprovedFollowUp } from './context.ts';
import { plansFirst } from './depth.ts';
import { checkCommands } from './member-prompts.ts';
import { isResearchStep } from './parallel.ts';
import { notPricier, type MemberRoute } from './routing.ts';
import type { Session } from './session.ts';
import { switchEstimate } from './session-keep.ts';
import { spanOf } from './spans.ts';
import { stepFiles } from './step-files.ts';
import type { Spawn } from './transitions.ts';

export const EXPECTED_BUILD_OUTPUT_TOKENS = 6_000;
export const LARGE_PLAN_STEPS = 3;
export const LARGE_PLAN_FILES = 8;
const COMPLEX = 3;

export const PLAN_SESSION_REASONS = {
  oneBuilder: 'one Builder carries the plan',
  cheaperReread: 'the re-read costs more than the cheaper Builder saves',
  severalBuilders: 'several Builders',
  large: 'large plan',
  provider: 'Builder on another provider',
  jevModel: 'Jev picked another Builder model',
  pinnedModel: 'pinned Builder model',
  cheaperBuilder: 'a cheaper Builder pays for the re-read',
  stronger: 'the Builder model is stronger',
  noSession: 'no Architect session to continue',
  copy: 'the Builder works in its own copy',
} as const;

export interface PlanSessionInput {
  builderSpans: number;
  lanes: number;
  largeSteps: number;
  changedFiles: number;
  complexity: number | null;
  architect: AgentPick;
  builder: MemberRoute;
  contextTokens: number;
}

export interface PlanSessionChoice {
  same: boolean;
  reason: string;
  architect: AgentPick;
  builder: AgentPick;
  cacheLossUsd: number | null;
  savingUsd: number | null;
}

function sameModel(a: AgentPick, b: AgentPick): boolean {
  return a.provider === b.provider && a.model === b.model;
}

export function decidePlanSession(input: PlanSessionInput): PlanSessionChoice {
  const estimate = switchEstimate(
    { pick: input.architect, contextTokens: input.contextTokens },
    input.builder.pick,
    EXPECTED_BUILD_OUTPUT_TOKENS,
  );
  const base = {
    architect: input.architect,
    builder: input.builder.pick,
    cacheLossUsd: estimate?.cacheLossUsd ?? null,
    savingUsd: estimate?.savingUsd ?? null,
  };
  const fresh = (reason: string): PlanSessionChoice => ({ ...base, same: false, reason });
  const same = (reason: string): PlanSessionChoice => ({ ...base, same: true, reason });
  if (input.lanes > 1 || input.builderSpans > 1) return fresh(PLAN_SESSION_REASONS.severalBuilders);
  const large =
    input.largeSteps >= LARGE_PLAN_STEPS ||
    input.changedFiles >= LARGE_PLAN_FILES ||
    (input.complexity !== null && Math.round(input.complexity) >= COMPLEX);
  if (large) return fresh(PLAN_SESSION_REASONS.large);
  if (input.builder.pick.provider !== input.architect.provider) {
    return fresh(PLAN_SESSION_REASONS.provider);
  }
  if (sameModel(input.builder.pick, input.architect)) return same(PLAN_SESSION_REASONS.oneBuilder);
  if (input.builder.routedBy === 'jev') return fresh(PLAN_SESSION_REASONS.jevModel);
  if (input.builder.routedBy === 'pinned') return fresh(PLAN_SESSION_REASONS.pinnedModel);
  if (!notPricier(input.builder.pick, input.architect)) return fresh(PLAN_SESSION_REASONS.stronger);
  if (estimate && estimate.savingUsd > estimate.cacheLossUsd) {
    return fresh(PLAN_SESSION_REASONS.cheaperBuilder);
  }
  return same(PLAN_SESSION_REASONS.cheaperReread);
}

export function continuedPick(architect: AgentPick, builder: AgentPick): AgentPick {
  return { ...architect, effort: builder.effort ?? architect.effort };
}

function buildSteps(s: Session): number[] {
  return s.flow.steps.flatMap((step, index) =>
    step.trim() && !isResearchStep(step) ? [index] : [],
  );
}

function changedFiles(steps: readonly string[]): number {
  return new Set(steps.flatMap((step) => stepFiles(step).changes)).size;
}

function trustedComplexity(s: Session): number | null {
  const jev = s.intake.body.jev;
  if (!jev || (jev.confidences.complexity ?? 0) < 0.5) return null;
  return jev.complexity;
}

export function planSessionCandidate(s: Session, spawn: Spawn): boolean {
  if (spawn.role !== 'builder' || spawn.reason !== 'first') return false;
  if (s.deps.handoff?.planSession === false) return false;
  if (!plansFirst(s.flow.depth) || !s.taskId || s.planSession !== undefined) return false;
  const architect = s.results.findLast((result) => result.role === 'architect');
  return architect?.outcome === 'succeeded' && !s.results.some((r) => r.role === 'builder');
}

async function contextTokensOf(s: Session, runId: string): Promise<number> {
  const { rows } = await s.deps.db.query<{ tokens: number | null }>(
    `SELECT (coalesce(input_tokens, 0) + coalesce(cached_read_tokens, 0)
       + coalesce(cached_write_tokens, 0))::int AS tokens
     FROM runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.tokens ?? 0;
}

export interface ContinuedBuild {
  route: MemberRoute;
  followUp: string;
  choice: PlanSessionChoice;
}

export async function choosePlanSession(
  s: Session,
  spawn: Spawn,
  route: MemberRoute,
  builderName: string,
  place: 'group' | 'copy' | null,
): Promise<{ choice: PlanSessionChoice; continued: ContinuedBuild | null }> {
  s.planSession = null;
  const architect = s.results.findLast((result) => result.role === 'architect')!;
  const architectRoute = s.routes.get('architect:0');
  const steps = buildSteps(s);
  const span = spanOf(spawn);
  const choice = decidePlanSession({
    builderSpans: place !== 'group' && steps.every((index) => span.includes(index)) ? 1 : 2,
    lanes: s.flow.lanes.length,
    largeSteps: s.largeSteps?.length ?? 0,
    changedFiles: changedFiles(s.flow.steps),
    complexity: trustedComplexity(s),
    architect: architectRoute?.pick ?? route.pick,
    builder: route,
    contextTokens: await contextTokensOf(s, architect.runId),
  });
  if (choice.same && place === 'copy') {
    return {
      choice: { ...choice, same: false, reason: PLAN_SESSION_REASONS.copy },
      continued: null,
    };
  }
  if (!choice.same || !architectRoute) return { choice, continued: null };
  const pick = continuedPick(architectRoute.pick, route.pick);
  const handed = await handOverSession(
    s.deps.db,
    s.input.identity.threadId,
    agentKey('ask', `${s.taskId}:architect:${architect.name}`),
    agentKey('do', `${s.taskId}:builder:${builderName}`),
    settingsHash({
      provider: pick.provider,
      model: pick.model,
      effort: pick.effort,
      mode: 'do',
      planning: false,
      roots: s.input.projectRoots,
    }),
  );
  if (!handed) {
    return {
      choice: { ...choice, same: false, reason: PLAN_SESSION_REASONS.noSession },
      continued: null,
    };
  }
  return {
    choice,
    continued: {
      route: { ...route, pick },
      followUp: planApprovedFollowUp({
        plan: s.flow.steps.filter(Boolean),
        steps: span,
        checkCommands: checkCommands(s),
        note: spawn.note,
        buildStyle: s.buildStyle,
      }),
      choice,
    },
  };
}
