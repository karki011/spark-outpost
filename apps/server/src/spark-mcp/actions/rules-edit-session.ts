import {
  providerLabel,
  RULES_SESSION_OPTION,
  SPARK_ACTION_KIND,
  type RulesEditAction,
  type RulesTarget,
} from '@spark-outpost/contracts';
import { childRun, spokenRun } from '../../mac-control/offered.ts';
import type { Queryable } from '../../persistence/db.ts';
import { runFromDevice } from '../../remote/run-mark.ts';

export type RulesRefusedRun = 'remote' | 'voice' | 'child' | 'assistant' | 'read_only' | 'no_chat';

export interface RulesRunScope {
  conversationId: string | null;
  runId: string | null;
  readOnly?: boolean;
  assistant?: boolean;
}

export async function rulesRunRefusal(
  db: Queryable,
  scope: RulesRunScope,
): Promise<RulesRefusedRun | null> {
  if (scope.assistant) return 'assistant';
  if (scope.readOnly) return 'read_only';
  if (!scope.conversationId || !scope.runId) return 'no_chat';
  if (await runFromDevice(db, scope.runId)) return 'remote';
  if (await childRun(db, scope.runId)) return 'child';
  if (await spokenRun(db, scope.runId)) return 'voice';
  return null;
}

export const RULES_RUN_REFUSALS: Record<RulesRefusedRun, string> = {
  remote: 'Spark rules are never changed from a turn started on a paired device. Ask from the Mac.',
  voice: 'Spark rules are never changed from a spoken message. Type it on the Mac instead.',
  child: 'Only the chat’s own turn can ask to change Spark rules.',
  assistant: 'Ask Spark does not change Spark rules. Ask in a chat on the Mac.',
  read_only: 'This turn is read-only, so it cannot change Spark rules.',
  no_chat: 'Spark rules change only from a chat turn.',
};

export interface RulesSession {
  provider: string;
  agentMode: string | null;
  modeName: string;
  agent: string;
  sessionRow: string | null;
  fromUser: boolean;
}

interface SessionRow {
  provider: string;
  agent_mode: string | null;
  modes: { id?: unknown; name?: unknown }[] | null;
  session_row: string | null;
  source: string | null;
  from_user: boolean | null;
}

const USER_SOURCES: ReadonlySet<string> = new Set(['ui', 'queue', 'e2e']);

function modeNameOf(modes: SessionRow['modes'], mode: string | null): string {
  const found = (modes ?? []).find((option) => option.id === mode);
  return typeof found?.name === 'string' ? found.name : (mode ?? 'its default mode');
}

function typedByUser(row: SessionRow): boolean {
  if (row.source === 'outpost') return row.from_user === true;
  return row.source !== null && USER_SOURCES.has(row.source);
}

export async function rulesSession(db: Queryable, runId: string): Promise<RulesSession | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT r.provider, r.agent_mode, cap.modes,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              AS source,
            (SELECT post.from_user FROM outpost_posts post
             WHERE post.id = r.user_message_id) AS from_user,
            (SELECT s.id FROM provider_sessions s
             WHERE s.conversation_id = r.conversation_id AND s.provider = r.provider
               AND s.closed_at IS NULL
             ORDER BY s.last_used_at DESC, s.created_at DESC LIMIT 1) AS session_row
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN provider_capabilities cap
         ON cap.workspace_id = c.workspace_id AND cap.provider = r.provider
     WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    provider: row.provider,
    agentMode: row.agent_mode,
    modeName: modeNameOf(row.modes, row.agent_mode),
    agent: providerLabel(row.provider),
    sessionRow: row.session_row,
    fromUser: typedByUser(row),
  };
}

const SAME_CARD = `a.kind = $2 AND a.payload->'sparkAction'->>'action' = 'rules_edit'
  AND a.payload->'sparkAction'->>'target' = $3`;

export async function sessionGrant(
  db: Queryable,
  conversationId: string,
  target: RulesTarget,
  session: RulesSession,
): Promise<string | null> {
  if (!session.sessionRow) return null;
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND ${SAME_CARD}
       AND a.status = 'allowed' AND a.decided_by = 'user' AND a.decision_option_id = $4
       AND a.payload->'sparkAction'->>'provider' = $5
       AND a.payload->'sparkAction'->>'agentMode' IS NOT DISTINCT FROM $6
       AND a.payload->'sparkAction'->>'sessionRow' = $7
       AND NOT EXISTS (
         SELECT 1 FROM runs later
         WHERE later.conversation_id = $1 AND later.parent_run_id IS NULL
           AND later.created_at > a.decided_at
           AND (later.provider IS DISTINCT FROM $5 OR later.agent_mode IS DISTINCT FROM $6))
     ORDER BY a.decided_at DESC LIMIT 1`,
    [
      conversationId,
      SPARK_ACTION_KIND,
      target,
      RULES_SESSION_OPTION,
      session.provider,
      session.agentMode,
      session.sessionRow,
    ],
  );
  return rows[0]?.id ?? null;
}

export async function waitingCard(
  db: Queryable,
  conversationId: string,
  action: RulesEditAction,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND ${SAME_CARD} AND a.status = 'pending'
       AND a.payload->'sparkAction'->'add' = $4::jsonb
       AND a.payload->'sparkAction'->'remove' = $5::jsonb
       AND a.payload->'sparkAction'->>'fileHash' = $6
     ORDER BY a.created_at DESC LIMIT 1`,
    [
      conversationId,
      SPARK_ACTION_KIND,
      action.target,
      JSON.stringify(action.add),
      JSON.stringify(action.remove),
      action.fileHash,
    ],
  );
  return rows[0]?.id ?? null;
}
