import type { AgentPick } from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import type { Queryable } from '../persistence/db.ts';
import { latestProviderSession } from '../persistence/provider-sessions.ts';
import { conversationKey, decideConversationResume } from '../workflow/conversation-session.ts';
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

const PREVIOUS_COLUMNS = `r.provider, r.model, r.route->>'modelLabel' AS model_label, r.effort,
  r.finished_at, r.thought_tokens AS reasoning_tokens, coalesce(r.context_used, coalesce(r.input_tokens, 0)
    + coalesce(r.cached_read_tokens, 0) + coalesce(r.cached_write_tokens, 0))::int AS context_tokens`;

export async function resumableConversation(
  db: Queryable,
  input: RunInput,
): Promise<ResumableSession | null> {
  const stored = await latestProviderSession(
    db,
    input.identity.threadId,
    conversationKey(input.provider),
  );
  const decision = decideConversationResume({
    stored,
    continuing: input.continuesRunId != null,
  });
  if (!stored?.model || !decision.resume) return null;
  const { rows } = await db.query<PreviousRow>(
    `SELECT ${PREVIOUS_COLUMNS} FROM runs r
     WHERE r.id = (SELECT e.run_id FROM provider_session_events e
       WHERE e.session_row_id = $1 AND e.run_id IS NOT NULL ORDER BY e.at DESC LIMIT 1)`,
    [stored.id],
  );
  const previous = rows[0];
  return {
    pick: {
      provider: input.provider,
      model: stored.model,
      modelLabel: previous?.model === stored.model ? previous.model_label : null,
      effort: previous?.effort ?? input.settings.effort,
    },
    contextTokens: stored.contextUsed ?? previous?.context_tokens ?? 0,
    reasoningTokens: previous?.reasoning_tokens ?? null,
    lastUsedAt: stored.lastUsedAt,
  };
}
