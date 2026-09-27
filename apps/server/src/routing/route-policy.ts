import type { AgentPick } from '@spark-outpost/contracts';
import type { RouterTier } from '../advisor/policy.ts';
import {
  builderEffort,
  chatPick,
  routeBuilder,
  type MemberRoute,
  type RouteContext,
  type RouteFacts,
} from '../orchestration/routing.ts';
import { candidateOf, pickOf, routeCandidates, type RouteCandidate } from './candidates.ts';

export type PolicyKind = 'ask' | 'pinned' | 'destructive' | 'one_candidate' | 'no_jev';

export interface RoutePolicy {
  kind: PolicyKind;
  candidates: RouteCandidate[];
  baselineTier: RouterTier | null;
  chat: AgentPick;
  rule: MemberRoute;
  codePick: AgentPick | null;
}

export const POLICY_TEXT: Readonly<Record<PolicyKind, string>> = {
  ask: 'asked Jev',
  pinned: 'pinned, no Jev call',
  destructive: 'destructive → top tier, no Jev call',
  one_candidate: 'one candidate, no Jev call',
  no_jev: 'Jev not connected → the chat model',
};

export function withEffort(context: RouteContext, pick: AgentPick): AgentPick {
  return { ...pick, effort: builderEffort(context, pick) };
}

function policyKind(
  context: RouteContext,
  facts: RouteFacts,
  candidates: readonly RouteCandidate[],
  jevConnected: boolean,
): PolicyKind {
  if (context.routing === 'pinned') return 'pinned';
  if (facts.destructive) return 'destructive';
  if (candidates.length <= 1) return 'one_candidate';
  if (!jevConnected) return 'no_jev';
  return 'ask';
}

function codePick(
  kind: PolicyKind,
  context: RouteContext,
  rule: MemberRoute,
  candidates: readonly RouteCandidate[],
): AgentPick | null {
  const chat = withEffort(context, chatPick(context));
  if (kind === 'ask') return null;
  if (kind === 'destructive') return rule.pick;
  if (kind === 'one_candidate' && candidates[0]) {
    return withEffort(context, pickOf(candidates[0], null));
  }
  return chat;
}

export function routePolicy(
  context: RouteContext,
  facts: RouteFacts,
  jevConnected: boolean,
): RoutePolicy {
  const candidates = routeCandidates(context.candidates);
  const chat = withEffort(context, chatPick(context));
  const rule = routeBuilder(context, facts);
  const kind = policyKind(context, facts, candidates, jevConnected);
  return {
    kind,
    candidates,
    baselineTier: candidateOf(candidates, chat)?.tier ?? null,
    chat,
    rule,
    codePick: codePick(kind, context, rule, candidates),
  };
}
