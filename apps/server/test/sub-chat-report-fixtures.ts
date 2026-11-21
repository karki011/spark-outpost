import type { ChatAsk, SubChatReport } from '@spark-outpost/contracts';
import { listChatAsks } from '../src/persistence/chat-asks.ts';
import { getSubChat } from '../src/persistence/sub-chats.ts';
import { startHeldSubChat } from '../src/sub-chats/start.ts';
import { fakeTarget, finishTurn } from './chat-ask-fixtures.ts';
import type { TestDb } from './support.ts';

export const REPORT_REPLY = [
  'The endpoint is in.',
  'Changed: GET /orders returns total_cents.',
  'Risks: The old total field is gone.',
  'Blockers: None',
].join('\n');

export interface StartedTask {
  id: string;
  askId: string;
  runId: string;
}

export async function taskOf(t: TestDb, subChatId: string): Promise<StartedTask> {
  const { rows } = await t.db.query<{ task_ask_id: string; run_id: string }>(
    `SELECT s.task_ask_id, a.run_id FROM sub_chats s JOIN chat_asks a ON a.id = s.task_ask_id
     WHERE s.conversation_id = $1`,
    [subChatId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Sub-chat ${subChatId} has no task turn.`);
  return { id: subChatId, askId: row.task_ask_id, runId: row.run_id };
}

export async function startTask(t: TestDb, subChatId: string): Promise<StartedTask> {
  const deps = { db: t.db, workspaceId: t.workspaceId, resolveTarget: fakeTarget };
  await startHeldSubChat(deps, subChatId, 'the test started it');
  return taskOf(t, subChatId);
}

export async function endTask(
  t: TestDb,
  task: StartedTask,
  status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded',
  reply: string = REPORT_REPLY,
): Promise<void> {
  await finishTurn(t, task.runId, status, reply);
}

export async function asksOf(
  t: TestDb,
  conversationId: string,
  kind: ChatAsk['kind'],
): Promise<ChatAsk[]> {
  const asks = await listChatAsks(t.db, conversationId);
  return asks.filter((ask) => ask.kind === kind && ask.to.id === conversationId);
}

export async function reportOn(t: TestDb, subChatId: string): Promise<SubChatReport | null> {
  return (await getSubChat(t.db, subChatId))?.report ?? null;
}

export async function reportedAt(t: TestDb, subChatId: string): Promise<Date | null> {
  return (await getSubChat(t.db, subChatId))?.reportedAt ?? null;
}
