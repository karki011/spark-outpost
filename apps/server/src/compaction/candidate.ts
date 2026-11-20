import type { RunMode } from '@spark-outpost/contracts';
import type { ContextReading, ProviderSessionRecord } from '../persistence/provider-sessions.ts';
import { sessionCommands } from '../persistence/session-commands.ts';
import type { TurnDeps } from '../workflow/agent-turn.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { SESSION_IDLE_MS } from '../workflow/session-decision.ts';
import { turnResume } from '../workflow/turn-resume.ts';
import { compactTakesInput, type CompactTarget } from './agent-compact.ts';
import { readingOf } from './policy.ts';

export interface Candidate extends CompactTarget {
  reading: ContextReading;
}

function modeOf(agentKey: string): RunMode | null {
  const mode = agentKey.slice('chat:'.length);
  return mode === 'ask' || mode === 'do' || mode === 'chat' ? mode : null;
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
  const { stored: session, decision } = await turnResume(deps.db, input, idleMs, new Date());
  if (!session || session.closedAt !== null || !decision.resume) return null;
  const reading = readingOf(session.contextUsed, session.contextSize);
  if (!reading) return null;
  const commands = await sessionCommands(deps.db, session.id);
  return {
    session,
    reading,
    mode: modeOf(session.agentKey),
    commands: commands.map((command) => command.name),
    compactTakesInput: compactTakesInput(commands),
    ...(await lastPick(deps, input, session)),
  };
}
