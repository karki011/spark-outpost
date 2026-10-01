import { z } from 'zod';
import type { InvolvementLevel, RunStatus } from '@spark-outpost/contracts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { chatIdFor, chatIdInput } from './chat-tools.ts';

export interface TopRun {
  id: string;
  conversation_id: string;
  chat_title: string;
  task_id: string | null;
  status: RunStatus;
  provider: string;
  model: string | null;
  mode: string | null;
  level: InvolvementLevel | null;
  error: string | null;
  created_at: Date;
}

const COLUMNS = `t.id, t.conversation_id, c.title AS chat_title, t.task_id, t.status, t.provider,
  COALESCE(t.used_model, t.model) AS model, t.mode, t.level, t.error, t.created_at`;

export const runLookupInput = {
  chat: chatIdInput,
  run: z
    .uuid()
    .optional()
    .describe("A run id (from spark_chat or spark_audit). Defaults to the chat's latest run."),
};

async function byRun(context: SparkToolContext, runId: string): Promise<TopRun | null> {
  const { rows } = await context.deps.db.query<TopRun>(
    `SELECT ${COLUMNS} FROM runs r
     JOIN runs t ON t.id = COALESCE(r.parent_run_id, r.id)
     JOIN conversations c ON c.id = t.conversation_id
     WHERE r.id = $1 AND c.workspace_id = $2`,
    [runId, context.scope.workspaceId],
  );
  return rows[0] ?? null;
}

async function latestInChat(context: SparkToolContext, chatId: string): Promise<TopRun | null> {
  const { rows } = await context.deps.db.query<TopRun>(
    `SELECT ${COLUMNS} FROM runs t JOIN conversations c ON c.id = t.conversation_id
     WHERE t.conversation_id = $1 AND c.workspace_id = $2 AND t.parent_run_id IS NULL
     ORDER BY t.created_at DESC LIMIT 1`,
    [chatId, context.scope.workspaceId],
  );
  return rows[0] ?? null;
}

export async function findTopRun(
  context: SparkToolContext,
  args: { chat?: string | undefined; run?: string | undefined },
): Promise<TopRun> {
  if (args.run) {
    const found = await byRun(context, args.run);
    if (!found) throw new SparkToolError('That run does not exist.');
    return found;
  }
  const found = await latestInChat(context, chatIdFor(context.scope, args.chat));
  if (!found) throw new SparkToolError('That chat does not exist or has no runs yet.');
  return found;
}
