import type { Queryable } from '../persistence/db.ts';
import type { ProtocolObserver, ProviderOutput, SessionTarget } from '../providers/provider.ts';
import {
  auditAssistantEvent,
  claimAssistantEvents,
  eventLine,
  recordAssistantEvent,
  sessionEventKind,
} from './assistant-events.ts';
import { factsForTurn } from './assistant-facts.ts';

export const LIVE_STATE_NOTE =
  'Look up the current state of chats, runs, approvals, spend, tickets and the calendar with the Spark tools for this question, even if an earlier answer in this conversation covered it.';

export interface AssistantTurn {
  note: string;
  see(output: ProviderOutput): void;
  settled(): Promise<void>;
}

export async function startAssistantTurn(
  db: Queryable,
  workspaceId: string,
  runId: string,
  audit: ProtocolObserver,
  target: SessionTarget | null,
): Promise<AssistantTurn> {
  const facts = await factsForTurn(db, workspaceId, runId);
  const note = [LIVE_STATE_NOTE, facts].filter(Boolean).join('\n\n');
  for (const event of await claimAssistantEvents(db, workspaceId, runId)) {
    auditAssistantEvent(audit, event);
  }
  const pending: Promise<void>[] = [];
  let seen = false;
  return {
    note,
    see(output) {
      if (output.kind !== 'session' || seen) return;
      seen = true;
      const kind = sessionEventKind(target, output.continued);
      const at = new Date().toISOString();
      auditAssistantEvent(audit, { id: runId, runId, kind, line: eventLine(kind, null), at });
      pending.push(
        recordAssistantEvent(db, workspaceId, kind, null, runId, true).catch((error: unknown) =>
          console.error('Could not record an Ask Spark event', error),
        ),
      );
    },
    async settled() {
      await Promise.all(pending);
    },
  };
}
