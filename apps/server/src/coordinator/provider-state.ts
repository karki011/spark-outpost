import { providerIssueKind, type TaskPiece } from '@spark-outpost/contracts';
import { COORD_PROVIDER_HEALTH_MS } from '../advisor/policy.ts';
import type { Queryable } from '../persistence/db.ts';
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

async function builderLoad(db: Queryable, workspaceId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ provider: string; running: number }>(
    `SELECT r.provider, COUNT(*)::int AS running FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.status IN ('running', 'awaiting_approval')
       AND r.role IN ('builder', 'integrator')
     GROUP BY r.provider`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.provider, row.running]));
}

export async function assignFacts(
  s: Session,
  parallel: boolean,
  failed: ReadonlyMap<string, string> = new Map(),
): Promise<AssignFacts> {
  const now = s.route.now ?? new Date();
  const facts = builderFacts(s);
  const builder = seatRoute(s, BUILDER_SPAWN).route.pick;
  return {
    route: s.route,
    builder,
    complex: facts.destructive || builderComplexity(s.route, facts) !== null,
    unhealthy: new Map([...(await recentIssues(s, now)), ...failed]),
    load: await builderLoad(s.deps.db, s.input.workspaceId),
    parallel,
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
