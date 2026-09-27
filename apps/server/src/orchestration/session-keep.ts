import type { AgentPick, RunMode } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import type { Queryable } from '../persistence/db.ts';
import { latestProviderSession } from '../persistence/provider-sessions.ts';
import { agentKey, decideResume, settingsHash } from '../workflow/session-decision.ts';
import { DEFAULT_SWEEP_LIMITS } from '../workflow/turn-session.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { notPricier, type MemberRoute } from './routing.ts';

export const KEPT_FOR_SESSION = 'kept model to resume session';
export const SWITCHED_FROM_SESSION = 'switched model; the session cache is lost';
export const EXPECTED_TURN_OUTPUT_TOKENS = 2_000;

export interface ResumableSession {
  pick: AgentPick;
  contextTokens: number;
}

export interface SessionChoice {
  kept: boolean;
  reason: string;
  session: AgentPick;
  cacheLossUsd: number | null;
  savingUsd: number | null;
}

export interface KeptRoute {
  route: MemberRoute;
  choice: SessionChoice | null;
}

function samePick(a: AgentPick, b: AgentPick): boolean {
  return a.provider === b.provider && a.model === b.model && a.effort === b.effort;
}

function priceOf(pick: AgentPick) {
  return cardFor({ id: pick.model ?? '', label: pick.modelLabel ?? '' }, pick.provider)?.price;
}

export function switchEstimate(
  session: ResumableSession,
  next: AgentPick,
  outputTokens = EXPECTED_TURN_OUTPUT_TOKENS,
): { cacheLossUsd: number; savingUsd: number } | null {
  const before = priceOf(session.pick);
  const after = priceOf(next);
  if (!before || !after) return null;
  const tokens = session.contextTokens;
  const cacheLossUsd =
    (tokens * (after.inputPerMillion - before.cachedInputPerMillion)) / 1_000_000;
  const savingUsd = (outputTokens * (before.outputPerMillion - after.outputPerMillion)) / 1_000_000;
  return { cacheLossUsd: Math.max(0, cacheLossUsd), savingUsd };
}

function worthSwitching(session: ResumableSession, next: AgentPick): SessionChoice {
  const estimate = switchEstimate(session, next);
  const base = {
    session: session.pick,
    cacheLossUsd: estimate?.cacheLossUsd ?? null,
    savingUsd: estimate?.savingUsd ?? null,
  };
  const upgrade = !notPricier(next, session.pick);
  const pays = estimate !== null && estimate.savingUsd > estimate.cacheLossUsd;
  return upgrade || pays
    ? { ...base, kept: false, reason: SWITCHED_FROM_SESSION }
    : { ...base, kept: true, reason: KEPT_FOR_SESSION };
}

export function keepSession(route: MemberRoute, session: ResumableSession | null): KeptRoute {
  if (!session || route.routedBy === 'pinned' || route.routedBy === 'fixed') {
    return { route, choice: null };
  }
  if (samePick(route.pick, session.pick)) return { route, choice: null };
  if (route.pick.provider !== session.pick.provider) return { route, choice: null };
  const kept = { ...route, pick: session.pick, routedBy: 'rules' as const };
  if (route.routedBy !== 'jev') {
    const choice = { ...worthSwitching(session, route.pick), kept: true, reason: KEPT_FOR_SESSION };
    return { route: kept, choice };
  }
  const choice = worthSwitching(session, route.pick);
  return { route: choice.kept ? kept : route, choice };
}

interface PreviousRow {
  provider: string | null;
  model: string | null;
  model_label: string | null;
  effort: string | null;
  context_tokens: number | null;
}

export async function resumableChat(
  db: Queryable,
  input: RunInput,
  mode: RunMode | null,
  idleMs = DEFAULT_SWEEP_LIMITS.idleMs,
  now = new Date(),
): Promise<ResumableSession | null> {
  const stored = await latestProviderSession(db, input.identity.threadId, agentKey(mode, null));
  if (!stored?.lastMessageId) return null;
  const { rows } = await db.query<PreviousRow>(
    `SELECT r.provider, r.model, r.route->>'modelLabel' AS model_label, r.effort,
            (coalesce(r.input_tokens, 0) + coalesce(r.cached_read_tokens, 0)
              + coalesce(r.cached_write_tokens, 0))::int AS context_tokens
     FROM messages m JOIN runs r ON r.id = m.run_id
     WHERE m.id = $1`,
    [stored.lastMessageId],
  );
  const previous = rows[0];
  if (!previous || previous.provider !== input.provider) return null;
  const hash = settingsHash({
    provider: previous.provider,
    model: previous.model,
    effort: previous.effort,
    mode,
    planning: false,
    roots: input.projectRoots,
  });
  const decision = decideResume({
    stored,
    hash,
    previousMessageId: input.previousMessageId ?? null,
    checksMessages: true,
    now,
    idleMs,
  });
  if (!decision.resume) return null;
  return {
    pick: {
      provider: previous.provider,
      model: previous.model,
      modelLabel: previous.model_label,
      effort: previous.effort,
    },
    contextTokens: previous.context_tokens ?? 0,
  };
}
