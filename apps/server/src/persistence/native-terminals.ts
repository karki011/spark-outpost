import {
  nativeTerminalSessionSchema,
  type ConversationSummary,
  type NativeTerminalSession,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface NativeTerminalRow {
  id: string;
  conversation_id: string;
  provider: 'claude' | 'codex';
  state: NativeTerminalSession['state'];
  cwd: string;
  label: string;
  native_session_id: string | null;
  native_turn_id: string | null;
  active_run_id: string | null;
  launch_message_id: string | null;
  generation: number;
  observation: NativeTerminalSession['observation'];
  reason: string | null;
  updated_at: Date;
}

export function nativeTerminalView(
  row: NativeTerminalRow,
  agentMode: string | null = null,
): NativeTerminalSession {
  return nativeTerminalSessionSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    provider: row.provider,
    state: row.state,
    cwd: row.cwd,
    label: row.label,
    updatedAt: row.updated_at.toISOString(),
    resumeAvailable: row.native_session_id !== null,
    runId: row.active_run_id,
    observation: row.observation,
    reason: row.reason,
    agentMode,
  });
}

export async function nativeTerminalMode(
  db: Queryable,
  row: Pick<NativeTerminalRow, 'conversation_id' | 'provider'>,
): Promise<string | null> {
  const { rows } = await db.query<{ mode: string | null }>(
    `SELECT COALESCE(used_mode, agent_mode) AS mode FROM runs
     WHERE conversation_id = $1 AND provider = $2 AND parent_run_id IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [row.conversation_id, row.provider],
  );
  return rows[0]?.mode ?? null;
}

export async function nativeTerminalRow(
  db: Queryable,
  conversationId: string,
): Promise<NativeTerminalRow | null> {
  const { rows } = await db.query<NativeTerminalRow>(
    'SELECT * FROM native_terminal_sessions WHERE conversation_id = $1',
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function withNativeTerminals(
  db: Queryable,
  conversations: ConversationSummary[],
): Promise<ConversationSummary[]> {
  if (conversations.length === 0) return conversations;
  const { rows } = await db.query<{
    id: string;
    session_type: 'chat' | 'terminal';
    terminal: NativeTerminalRow | null;
  }>(
    `SELECT c.id, c.session_type, CASE WHEN t.id IS NOT NULL THEN to_jsonb(t) END AS terminal
     FROM conversations c LEFT JOIN native_terminal_sessions t ON t.conversation_id = c.id
     WHERE c.id = ANY($1::uuid[])`,
    [conversations.map((conversation) => conversation.id)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return conversations.map((conversation) => {
    const row = byId.get(conversation.id);
    const terminal = row?.terminal
      ? nativeTerminalView({ ...row.terminal, updated_at: new Date(row.terminal.updated_at) })
      : null;
    const waiting =
      terminal?.state === 'waiting_for_input' || terminal?.state === 'waiting_for_permission';
    return {
      ...conversation,
      sessionType: row?.session_type ?? 'chat',
      terminal,
      needsInput: conversation.needsInput || waiting,
      attention:
        conversation.attention ??
        (waiting
          ? {
              kind: terminal.state === 'waiting_for_permission' ? 'permission' : 'input',
              title:
                terminal.state === 'waiting_for_permission'
                  ? 'The agent is waiting for permission in the terminal.'
                  : 'The agent needs your answer in the terminal.',
              agentName: terminal.provider === 'claude' ? 'Claude Code' : 'Codex',
              provider: terminal.provider,
              approvalId: null,
            }
          : null),
    };
  });
}

export async function notifyNativeTerminal(db: Queryable, conversationId: string): Promise<void> {
  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'conversation', conversationId, runId: null }),
  ]);
}
