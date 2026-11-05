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

export async function openChatCommands(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  provider: string,
): Promise<AgentCommand[]> {
  const { rows } = await db.query<{ available_commands: unknown }>(
    `SELECT s.available_commands FROM provider_sessions s
     JOIN conversations c ON c.id = s.conversation_id
     WHERE s.conversation_id = $1 AND c.workspace_id = $2 AND s.provider = $3
       AND starts_with(s.agent_key, 'chat:') AND s.closed_at IS NULL
     ORDER BY s.last_used_at DESC, s.created_at DESC
     LIMIT 1`,
    [conversationId, workspaceId, provider],
  );
  return parseCommands(rows[0]?.available_commands);
}
