import type { RunMode } from '@spark-outpost/contracts';
import {
  openChatSessions,
  type ContextReading,
  type ProviderSessionRecord,
} from '../persistence/provider-sessions.ts';
import { sessionCommands } from '../persistence/session-commands.ts';
import type { TurnDeps } from '../workflow/agent-turn.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { SESSION_IDLE_MS, decideResume } from '../workflow/session-decision.ts';
import { compactTakesInput, type CompactTarget } from './agent-compact.ts';
import { readingOf, usedPercent } from './policy.ts';

export interface Candidate extends CompactTarget {
  reading: ContextReading;
}

function modeOf(agentKey: string): RunMode | null {
  const mode = agentKey.slice('chat:'.length);
  return mode === 'ask' || mode === 'do' || mode === 'chat' ? mode : null;
}

function resumes(
  session: ProviderSessionRecord,
  input: RunInput,
  idleMs: number,
  now: Date,
): boolean {
  return (
    decideResume({
      stored: session,
      hash: session.settingsHash,
      previousMessageId: input.previousMessageId ?? null,
      checksMessages: true,
      now,
      idleMs,
    }).resume !== null
  );
}

async function lastPick(deps: TurnDeps, input: RunInput, session: ProviderSessionRecord) {
  const { rows } = await deps.db.query<{ model: string | null; effort: string | null }>(
    'SELECT r.model, r.effort FROM messages m JOIN runs r ON r.id = m.run_id WHERE m.id = $1',
    [session.lastMessageId],
  );
  return {
    model: rows[0]?.model ?? input.settings.model,
    effort: rows[0]?.effort ?? input.settings.effort,
  };
}

export async function candidateFor(deps: TurnDeps, input: RunInput): Promise<Candidate | null> {
  const idleMs = deps.sessionLimits?.idleMs ?? SESSION_IDLE_MS;
  const now = new Date();
  const sessions = await openChatSessions(deps.db, input.identity.threadId);
  let best: { session: ProviderSessionRecord; reading: ContextReading } | null = null;
  for (const session of sessions) {
    const reading = readingOf(session.contextUsed, session.contextSize);
    if (!reading || session.provider !== input.provider) continue;
    if (!resumes(session, input, idleMs, now)) continue;
    if (!best || usedPercent(reading) > usedPercent(best.reading)) best = { session, reading };
  }
  if (!best) return null;
  const commands = await sessionCommands(deps.db, best.session.id);
  return {
    ...best,
    mode: modeOf(best.session.agentKey),
    commands: commands.map((command) => command.name),
    compactTakesInput: compactTakesInput(commands),
    ...(await lastPick(deps, input, best.session)),
  };
}
