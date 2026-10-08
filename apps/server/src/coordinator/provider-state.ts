import { providerIssueKind, type TaskPiece } from '@spark-outpost/contracts';
import { COORD_PROVIDER_HEALTH_MS } from '../advisor/policy.ts';
import { providerIssues } from '../persistence/provider-health.ts';
import { builderFacts, seatRoute } from '../orchestration/member-routes.ts';
import { builderComplexity, builderEffort, type MemberRoute } from '../orchestration/routing.ts';
import type { Session } from '../orchestration/session.ts';
import type { AssignFacts } from './assign.ts';

const ISSUE_WORDS = {
  auth: 'signed out',
  usage_limit: 'out of budget',
  rate_limit: 'rate limited',
};
const BUILDER_SPAWN = { role: 'builder', reason: 'first', escalate: false, note: null } as const;
const DOWN = /stopped unexpectedly|could not start|is not available/i;

export function providerFailure(error: string | null): string | null {
  if (!error) return null;
  const kind = providerIssueKind(error);
  if (kind) return ISSUE_WORDS[kind];
  return DOWN.test(error) ? 'unavailable' : null;
}

async function recentIssues(s: Session, now: Date): Promise<Map<string, string>> {
  const issues = await providerIssues(s.deps.db, s.input.workspaceId).catch(() => []);
  const since = now.getTime() - COORD_PROVIDER_HEALTH_MS;
  return new Map(
    issues
      .filter((issue) => Date.parse(issue.at) >= since)
      .map((issue) => [issue.provider, ISSUE_WORDS[issue.kind]]),
  );
}

export async function assignFacts(s: Session): Promise<AssignFacts> {
  const now = s.route.now ?? new Date();
  const facts = builderFacts(s);
  const builder = seatRoute(s, BUILDER_SPAWN).route.pick;
  return {
    route: s.route,
    builder,
    complex: facts.destructive || builderComplexity(s.route, facts) !== null,
    unhealthy: await recentIssues(s, now),
  };
}

export function pieceRoute(s: Session, piece: TaskPiece): MemberRoute | null {
  if (!piece.provider || piece.research) return null;
  const base = seatRoute(s, BUILDER_SPAWN).route;
  const same = piece.provider === base.pick.provider && piece.model === base.pick.model;
  if (same && !piece.pickNote) return null;
  const candidate = s.route.candidates.find((entry) => entry.provider === piece.provider);
  const label = candidate?.models.find((model) => model.id === piece.model)?.label ?? null;
  const pick = { provider: piece.provider, model: piece.model, modelLabel: label, effort: null };
  return {
    pick: same ? base.pick : { ...pick, effort: builderEffort(s.route, pick) },
    routedBy: piece.pickNote?.startsWith('Jev:') ? 'jev' : 'rules',
    rule: piece.pickNote ?? `piece → ${candidate?.name ?? piece.provider}`,
    autoWouldUse: null,
  };
}
