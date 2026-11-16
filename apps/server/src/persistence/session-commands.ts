import { z } from 'zod';
import { agentCommandSchema, type AgentCommand } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

const storedCommandsSchema = z.array(agentCommandSchema);

function parseCommands(value: unknown): AgentCommand[] {
  const parsed = storedCommandsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export async function recordSessionCommands(
  db: Queryable,
  sessionRowId: string,
  commands: readonly AgentCommand[],
): Promise<void> {
  await db.query('UPDATE provider_sessions SET available_commands = $2::jsonb WHERE id = $1', [
    sessionRowId,
    JSON.stringify(commands),
  ]);
}

export async function sessionCommands(
  db: Queryable,
  sessionRowId: string,
): Promise<AgentCommand[]> {
  const { rows } = await db.query<{ available_commands: unknown }>(
    'SELECT available_commands FROM provider_sessions WHERE id = $1',
    [sessionRowId],
  );
  return parseCommands(rows[0]?.available_commands);
}

export async function latestChatCommands(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  provider: string,
): Promise<{ commands: AgentCommand[]; closeReason: string | null } | null> {
  const { rows } = await db.query<{ available_commands: unknown; close_reason: string | null }>(
    `SELECT s.available_commands, s.close_reason FROM provider_sessions s
     JOIN conversations c ON c.id = s.conversation_id
     WHERE s.conversation_id = $1 AND c.workspace_id = $2 AND s.provider = $3
       AND starts_with(s.agent_key, 'chat:')
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 1`,
    [conversationId, workspaceId, provider],
  );
  const row = rows[0];
  return row
    ? { commands: parseCommands(row.available_commands), closeReason: row.close_reason }
    : null;
}
