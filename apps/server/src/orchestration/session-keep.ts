import type { AgentPick, RunMode } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import type { Queryable } from '../persistence/db.ts';
import { latestProviderSession } from '../persistence/provider-sessions.ts';
import { agentKey, decideResume, settingsHash } from '../workflow/session-decision.ts';
import { DEFAULT_SWEEP_LIMITS } from '../workflow/turn-session.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { keptText, leftText, type ResumableSession, type SessionChoice } from './cache-switch.ts';
import type { MemberRoute } from './routing.ts';

export const KEPT_FOR_SESSION = 'kept model to resume session';

export interface KeptRoute {
  route: MemberRoute;
  choice: SessionChoice | null;
}

function samePick(a: AgentPick, b: AgentPick): boolean {
  return a.provider === b.provider && a.model === b.model && a.effort === b.effort;
}

function tierOf(pick: AgentPick): string | null {
  return (
    cardFor({ id: pick.model ?? '', label: pick.modelLabel ?? '' }, pick.provider)?.tier ?? null
  );
}

export function keepSession(
  route: MemberRoute,
  session: ResumableSession | null,
  needsTop: boolean | string = false,
  now: Date = new Date(),
): KeptRoute {
  if (!session || route.routedBy === 'pinned' || route.routedBy === 'fixed') {
    return { route, choice: null };
  }
  if (samePick(route.pick, session.pick)) return { route, choice: null };
  if (route.pick.provider !== session.pick.provider) return { route, choice: null };
  if (needsTop && tierOf(route.pick) !== tierOf(session.pick)) {
    const reason = typeof needsTop === 'string' ? needsTop : 'destructive work needs the top tier';
    return {
      route,
      choice: { kept: false, reason: leftText(reason, session, now), session: session.pick },
    };
  }
  const kept = { ...route, pick: session.pick, rule: KEPT_FOR_SESSION };
  const reason = keptText(session, now);
  return { route: kept, choice: { kept: true, reason, session: session.pick } };
}

interface PreviousRow {
  provider: string;
  model: string | null;
  model_label: string | null;
  effort: string | null;
  context_tokens: number | null;
  reasoning_tokens: number | null;
  finished_at: Date | null;
}

async function resumable(
  db: Queryable,
  input: RunInput,
  mode: RunMode,
  key: string | null,
  previous: PreviousRow | undefined,
  idleMs: number,
  now: Date,
): Promise<ResumableSession | null> {
  const stored = await latestProviderSession(db, input.identity.threadId, agentKey(mode, key));
  if (!stored || !previous || previous.provider !== input.provider) return null;
  const hash = settingsHash({
    provider: previous.provider,
    model: previous.model,
    effort: previous.effort,
    mode,
    planning: false,
    roots: input.projectRoots,
    keyed: key !== null,
  });
  const decision = decideResume({
    stored,
    hash,
    previousMessageId: input.previousMessageId ?? null,
    checksMessages: key === null,
    now,
    idleMs,
    continuing: input.continuesRunId != null,
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
    reasoningTokens: previous.reasoning_tokens,
    lastUsedAt: previous.finished_at ?? stored.lastUsedAt,
  };
}

const PREVIOUS_COLUMNS = `r.provider, r.model, r.route->>'modelLabel' AS model_label, r.effort,
  r.finished_at, r.thought_tokens AS reasoning_tokens, coalesce(r.context_used, coalesce(r.input_tokens, 0)
    + coalesce(r.cached_read_tokens, 0) + coalesce(r.cached_write_tokens, 0))::int AS context_tokens`;

export async function resumableTask(
  db: Queryable,
  input: RunInput,
  resumeKey: string,
  idleMs = DEFAULT_SWEEP_LIMITS.idleMs,
  now = new Date(),
): Promise<ResumableSession | null> {
  const { rows } = await db.query<PreviousRow>(
    `SELECT ${PREVIOUS_COLUMNS} FROM runs r
     WHERE r.conversation_id = $1 AND r.route->>'resumeKey' = $2
     ORDER BY r.created_at DESC LIMIT 1`,
    [input.identity.threadId, resumeKey],
  );
  return resumable(db, input, 'do', resumeKey, rows[0], idleMs, now);
}

export async function resumableChat(
  db: Queryable,
  input: RunInput,
  mode: RunMode,
  idleMs = DEFAULT_SWEEP_LIMITS.idleMs,
  now = new Date(),
): Promise<ResumableSession | null> {
  const stored = await latestProviderSession(db, input.identity.threadId, agentKey(mode, null));
  if (!stored?.lastMessageId) return null;
  const { rows } = await db.query<PreviousRow>(
    `SELECT ${PREVIOUS_COLUMNS} FROM messages m JOIN runs r ON r.id = m.run_id WHERE m.id = $1`,
    [stored.lastMessageId],
  );
  return resumable(db, input, mode, null, rows[0], idleMs, now);
}
