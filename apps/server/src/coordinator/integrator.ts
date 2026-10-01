import { nextCrewName, type AgentPick, type TaskPiece } from '@spark-outpost/contracts';
import { usedNames } from '../persistence/orchestrations.ts';
import { seatRoute } from '../orchestration/member-routes.ts';
import { builderEffort, type MemberRoute } from '../orchestration/routing.ts';
import type { Seat, Session } from '../orchestration/session.ts';
import { builderEnvFor } from './builder-env.ts';
import type { Coordination } from './state.ts';

export type IntegratorWork = 'glue' | 'fix' | 'conflict';

export interface IntegratorFacts {
  pieces: readonly Pick<TaskPiece, 'key' | 'provider' | 'model' | 'owns'>[];
  topTier: ReadonlySet<string>;
  work: IntegratorWork;
  findings: readonly string[];
}

export type IntegratorModel =
  | { follow: { provider: string; model: string | null }; reason: string }
  | { follow: null; reason: string };

const BUILDER_SPAWN = { role: 'builder', reason: 'first', escalate: false, note: null } as const;

function mentions(finding: string, owns: readonly string[]): boolean {
  return owns.some((path) => finding.includes(path));
}

function stakesReason(facts: IntegratorFacts): string | null {
  if (facts.work !== 'fix' || facts.findings.length === 0) return null;
  const top = facts.pieces.filter((piece) => facts.topTier.has(piece.key));
  if (top.length === 0) return null;
  const named = facts.findings.some((finding) =>
    facts.pieces.some((piece) => mentions(finding, piece.owns)),
  );
  const hit = named
    ? top.filter((piece) => facts.findings.some((finding) => mentions(finding, piece.owns)))
    : top;
  if (hit.length === 0) return null;
  return `Critic findings touch high-stakes ${hit.map((piece) => piece.key).join(', ')}`;
}

function sharedModel(pieces: IntegratorFacts['pieces']) {
  const counts = new Map<string, { provider: string; model: string | null; count: number }>();
  for (const piece of pieces) {
    const id = `${piece.provider}/${piece.model ?? ''}`;
    const entry = counts.get(id) ?? { provider: piece.provider!, model: piece.model, count: 0 };
    counts.set(id, { ...entry, count: entry.count + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best && best.count * 2 > pieces.length ? best : null;
}

export function integratorModel(facts: IntegratorFacts): IntegratorModel {
  if (facts.work === 'conflict') {
    return { follow: null, reason: 'a merge conflict across pieces' };
  }
  const built = facts.pieces.filter((piece) => piece.provider);
  const shared = sharedModel(built);
  if (!shared) return { follow: null, reason: 'the pieces used different models' };
  const stakes = stakesReason(facts);
  if (stakes) return { follow: null, reason: stakes };
  const { provider, model, count } = shared;
  return {
    follow: { provider, model },
    reason: `${count} of ${built.length} pieces ran on this model; same model keeps the cache`,
  };
}

function landed(coordination: Coordination) {
  return (coordination.list?.pieces ?? []).filter(
    (piece) => piece.status === 'landed' && !piece.research,
  );
}

function followed(s: Session, base: MemberRoute, to: { provider: string; model: string | null }) {
  if (to.provider === base.pick.provider && to.model === base.pick.model) return base.pick;
  const candidate = s.route.candidates.find((entry) => entry.provider === to.provider);
  const label = candidate?.models.find((model) => model.id === to.model)?.label ?? null;
  const pick: AgentPick = { ...to, modelLabel: label, effort: null };
  return { ...pick, effort: builderEffort(s.route, pick) };
}

export function integratorRoute(
  s: Session,
  coordination: Coordination,
  work: IntegratorWork,
): MemberRoute {
  const base = seatRoute(s, BUILDER_SPAWN).route;
  const choice = integratorModel({
    pieces: landed(coordination),
    topTier: coordination.topTier ?? new Set(),
    work,
    findings: s.findings,
  });
  if (!choice.follow) {
    const kept = `kept for ${choice.reason}`;
    return { ...base, note: base.note ? `${base.note} · ${kept}` : kept };
  }
  return {
    pick: followed(s, base, choice.follow),
    routedBy: 'rules',
    rule: 'integrator follows the pieces',
    autoWouldUse: null,
    note: choice.reason,
  };
}

export async function integratorSeat(s: Session, coordination: Coordination): Promise<Seat> {
  const used = await usedNames(s.deps.db, s.taskId!, 'integrator');
  const name = used[0] ?? nextCrewName('integrator', used);
  return {
    role: 'integrator',
    name,
    resumeKey: `${s.taskId}:integrator`,
    prompt: null,
    route: {
      guard: { coordinated: true, owned: null },
      builderEnv: builderEnvFor(coordination.builderEnv, 1, name),
    },
  };
}
