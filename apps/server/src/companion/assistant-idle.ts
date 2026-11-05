import { insertCompaction } from '../persistence/compactions.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import {
  openChatSessions,
  recordCompacted,
  type ContextReading,
  type ProviderSessionRecord,
} from '../persistence/provider-sessions.ts';
import { sessionCommands } from '../persistence/session-commands.ts';
import { compactionThresholds } from '../persistence/setup.ts';
import type { Provider } from '../providers/provider.ts';
import { compactInSession, offersCompact } from '../compaction/agent-compact.ts';
import { agentCompactWorked, readingOf } from '../compaction/policy.ts';
import { kilo } from '../agents/acp/long-context.ts';
import { loadRunInput } from '../workflow/run-input.ts';
import { recordAssistantEvent } from './assistant-events.ts';

export interface IdleLimits {
  idleMs: number;
  minTokens: number;
}

export const ASSISTANT_IDLE_LIMITS: IdleLimits = { idleMs: 15 * 60_000, minTokens: 40_000 };

export interface IdleFacts {
  lastAnsweredAt: Date | null;
  busy: boolean;
  compactedSince: boolean;
  autoCompact: boolean;
  reading: ContextReading | null;
}

export function idleCompactDue(facts: IdleFacts, now: Date, limits: IdleLimits): boolean {
  if (facts.busy || facts.compactedSince || !facts.autoCompact) return false;
  if (!facts.lastAnsweredAt || !facts.reading) return false;
  if (now.getTime() - facts.lastAnsweredAt.getTime() < limits.idleMs) return false;
  return facts.reading.used >= limits.minTokens;
}

export interface AssistantIdleCompaction {
  sweep(now?: Date): Promise<void>;
  wait(conversationId: string): Promise<void>;
}

interface IdleRow {
  workspace_id: string;
  conversation_id: string;
  run_id: string;
  provider: string;
  finished_at: Date | null;
  busy: boolean;
  compacted_since: boolean;
}

async function idleAssistants(db: Db): Promise<IdleRow[]> {
  const { rows } = await db.query<IdleRow>(
    `SELECT p.workspace_id, p.assistant_conversation_id AS conversation_id,
       last.id AS run_id, last.provider, last.finished_at,
       EXISTS (SELECT 1 FROM runs a WHERE a.conversation_id = p.assistant_conversation_id
         AND a.status IN ('queued', 'running', 'awaiting_approval')) AS busy,
       EXISTS (SELECT 1 FROM assistant_events e WHERE e.workspace_id = p.workspace_id
         AND e.kind = 'compacted_idle' AND e.at >= last.finished_at) AS compacted_since
     FROM profiles p
     JOIN LATERAL (
       SELECT r.id, r.provider, r.finished_at FROM runs r
       WHERE r.conversation_id = p.assistant_conversation_id AND r.parent_run_id IS NULL
       ORDER BY r.created_at DESC LIMIT 1
     ) last ON true
     WHERE p.assistant_conversation_id IS NOT NULL`,
  );
  return rows;
}

function sessionFor(sessions: ProviderSessionRecord[], provider: string) {
  return sessions.find((session) => session.provider === provider) ?? null;
}

async function compactIdle(
  db: Db,
  providers: ReadonlyMap<string, Provider>,
  row: IdleRow,
  session: ProviderSessionRecord,
  reading: ContextReading,
): Promise<void> {
  const commands = (await sessionCommands(db, session.id)).map((command) => command.name);
  if (!offersCompact(commands)) return;
  const input = await loadRunInput(db, row.run_id);
  const log = {
    runId: row.run_id,
    write: (entries: Parameters<typeof insertFinishedRunEntries>[2]) =>
      insertFinishedRunEntries(db, row.run_id, entries),
  };
  const target = {
    session,
    mode: input.mode,
    commands,
    model: input.settings.model,
    effort: input.settings.effort,
  };
  const ignore = async () => null;
  const compacted = await compactInSession(
    { db, providers, leaseSeconds: 30 },
    log,
    input,
    target,
    ignore,
    new AbortController().signal,
  );
  if (!compacted || !agentCompactWorked(reading, compacted.after)) {
    console.error(`Ask Spark's idle compaction did not shrink its context (run ${row.run_id})`);
    return;
  }
  await recordCompacted(db, session.id, compacted.after);
  await insertCompaction(db, {
    conversationId: row.conversation_id,
    runId: row.run_id,
    sessionRowId: session.id,
    agentKey: session.agentKey,
    method: 'agent',
    tokensBefore: reading.used,
    tokensAfter: null,
    contextSize: compacted.after.size,
    summary: compacted.text || null,
    lastMessageId: input.previousMessageId ?? null,
  });
  await recordAssistantEvent(
    db,
    row.workspace_id,
    'compacted_idle',
    `${kilo(reading.used)} → ${kilo(compacted.after.used)} tokens`,
  );
}

export function assistantIdleCompaction(
  db: Db,
  providers: ReadonlyMap<string, Provider>,
  limits: IdleLimits = ASSISTANT_IDLE_LIMITS,
): AssistantIdleCompaction {
  const running = new Map<string, Promise<void>>();
  const tried = new Map<string, string>();
  const consider = async (row: IdleRow, now: Date) => {
    if (tried.get(row.conversation_id) === row.run_id) return;
    const session = sessionFor(await openChatSessions(db, row.conversation_id), row.provider);
    const reading = session ? readingOf(session.contextUsed, session.contextSize) : null;
    const thresholds = await compactionThresholds(db, row.workspace_id);
    const facts: IdleFacts = {
      lastAnsweredAt: row.finished_at,
      busy: row.busy,
      compactedSince: row.compacted_since,
      autoCompact: thresholds.autoCompact,
      reading,
    };
    if (!session || !reading || !idleCompactDue(facts, now, limits)) return;
    tried.set(row.conversation_id, row.run_id);
    const work = compactIdle(db, providers, row, session, reading)
      .catch((error: unknown) => console.error('Could not compact Ask Spark while idle', error))
      .finally(() => running.delete(row.conversation_id));
    running.set(row.conversation_id, work);
  };
  return {
    async sweep(now = new Date()) {
      for (const row of await idleAssistants(db)) {
        if (running.has(row.conversation_id)) continue;
        await consider(row, now);
      }
    },
    async wait(conversationId) {
      await running.get(conversationId);
    },
  };
}
