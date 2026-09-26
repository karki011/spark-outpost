import type { AgentPick, JevIntake, Risk, Scope } from '@spark-outpost/contracts';
import { ASK_AT, gate } from '../advisor/gate.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import {
  candidateFor,
  chatPick,
  effortIds,
  notPricier,
  topTierPick,
  type JevPick,
  type MemberRoute,
  type RouteContext,
} from './routing.ts';
import { highEffort, middleTier } from './tiers.ts';

export interface PlanShape {
  files: number;
  complexity: number | null;
  scope: Scope | null;
  sure: boolean;
}

export type ArchitectRule =
  'destructive' | 'simple' | 'unsure' | 'vague' | 'short plan' | 'top tier';

export const SHORT_PLAN_FILES = 5;
const MEDIUM_COMPLEXITY = 2;
const SMALL_SCOPES: readonly Scope[] = ['one_spot', 'one_module'];

function trusted(jev: JevIntake | null, key: string): boolean {
  return jev !== null && (jev.confidences[key] ?? 0) >= ASK_AT;
}

export function planShape(files: number, jev: JevIntake | null): PlanShape {
  const complexity = trusted(jev, 'complexity') ? jev!.complexity : null;
  const scope = jev?.scope ?? null;
  return { files, complexity, scope, sure: trusted(jev, 'complexity') && trusted(jev, 'scope') };
}

function moderateOrLower(complexity: number | null): boolean {
  return complexity !== null && Math.round(complexity) <= MEDIUM_COMPLEXITY;
}

export function isSimple(shape: PlanShape): boolean {
  if (!shape.sure || shape.scope === null) return false;
  return SMALL_SCOPES.includes(shape.scope) && moderateOrLower(shape.complexity);
}

export function isVague(shape: PlanShape): boolean {
  return shape.files === 0 && shape.scope !== 'one_spot';
}

export function shortPlan(risk: Risk, shape: PlanShape): boolean {
  if (risk === 'destructive' || shape.files === 0) return false;
  if (shape.complexity !== null && !moderateOrLower(shape.complexity)) return false;
  return shape.files < SHORT_PLAN_FILES || shape.complexity !== null;
}

export function architectRule(risk: Risk, shape: PlanShape): ArchitectRule {
  if (risk === 'destructive') return 'destructive';
  if (isSimple(shape)) return 'simple';
  if (shape.scope !== null && !shape.sure) return 'unsure';
  if (shape.scope !== null && isVague(shape)) return 'vague';
  return shortPlan(risk, shape) ? 'short plan' : 'top tier';
}

const MIDDLE_RULES: readonly ArchitectRule[] = ['simple', 'short plan'];

export function architectPick(context: RouteContext, rule: ArchitectRule): AgentPick {
  const provider = context.chat.provider;
  const top = topTierPick(context, provider);
  if (!MIDDLE_RULES.includes(rule)) return top;
  const candidate = candidateFor(context, provider);
  const middle = candidate ? middleTier(selectableModels(candidate)) : null;
  return middle ? { ...top, model: middle.id, modelLabel: middle.label } : top;
}

export interface ArchitectRoute extends MemberRoute {
  rule: ArchitectRule;
  rulePick: AgentPick;
}

function pinnedPick(context: RouteContext): AgentPick {
  const effort = highEffort(effortIds(candidateFor(context, context.chat.provider))) ?? 'high';
  return { ...chatPick(context), effort };
}

function autoRoute(
  context: RouteContext,
  rule: ArchitectRule,
  rulePick: AgentPick,
  jev: JevPick | null,
): ArchitectRoute {
  const base = { rule, rulePick, autoWouldUse: jev?.pick ?? null };
  if (!jev) return { ...base, pick: rulePick, routedBy: 'fixed', gate: null };
  if (rule === 'destructive') return { ...base, pick: rulePick, routedBy: 'rules', gate: null };
  const downgrade = notPricier(jev.pick, rulePick);
  const decision = gate({ confidence: jev.confidence ?? 1 }, context.risk, context.level, {
    downgrade,
    readsOnly: true,
  });
  return decision.decision === 'act'
    ? { ...base, pick: jev.pick, routedBy: 'jev', gate: decision }
    : { ...base, pick: rulePick, routedBy: 'rules', gate: decision };
}

export function routeArchitect(
  context: RouteContext,
  shape: PlanShape,
  jev: JevPick | null = null,
): ArchitectRoute {
  const rule = architectRule(context.risk, shape);
  const auto = autoRoute(context, rule, architectPick(context, rule), jev);
  if (context.routing !== 'pinned') return auto;
  return { ...auto, pick: pinnedPick(context), routedBy: 'pinned', autoWouldUse: auto.pick };
}
