import { randomUUID } from 'node:crypto';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import type { SparkScope } from '../src/spark-mcp/deps.ts';
import type { RecordedHooks } from './spark-mcp-support.ts';
import { connectCliProvider, type TestDb } from './support.ts';

export async function assistantSetup(t: TestDb): Promise<string> {
  await connectCliProvider(t, 'claude');
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
  return ensureAssistantChat(t.db, t.workspaceId);
}

export async function assistantRun(
  t: TestDb,
  assistant: string,
  question: string,
  source = 'ui',
): Promise<string> {
  const messageId = randomUUID();
  const runId = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [messageId, assistant, question],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source)
     VALUES ($1, $2, $3, 'claude', 'running', $4)`,
    [runId, assistant, messageId, source],
  );
  return runId;
}

export async function setActs(t: TestDb, acts: 'act' | 'manual'): Promise<void> {
  await t.db.query('UPDATE profiles SET assistant_acts = $2 WHERE workspace_id = $1', [
    t.workspaceId,
    acts,
  ]);
}

export function assistantScope(
  assistant: string,
  runId: string,
  recorded: RecordedHooks,
): Partial<SparkScope> {
  return {
    conversationId: assistant,
    runId,
    readOnly: true,
    assistant: true,
    actions: recorded.hooks,
  };
}
