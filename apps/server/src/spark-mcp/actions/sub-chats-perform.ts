import type { StartSubChatsAction, StopSubChatAction } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../../persistence/audit-log.ts';
import {
  NOT_THIS_CHATS_SUB_CHAT,
  startedMessage,
  startSubChats,
  type StartedBy,
} from '../../sub-chats/start.ts';
import { stopRun } from '../../workflow/stop-run.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export async function performStartSubChats(
  { deps, scope }: SparkToolContext,
  action: StartSubChatsAction,
  startedBy: StartedBy,
  approvalId: string | null,
): Promise<Performed> {
  const started = await startSubChats(
    { db: deps.db, workspaceId: scope.workspaceId },
    { action, approvalId, runId: scope.runId, startedBy },
  );
  return {
    message: startedMessage(started),
    url: null,
    output: {
      subChats: started.subChats.map(({ id, title, held, delivered }) => ({
        id,
        title,
        status: held ? 'held' : 'working',
        ...(delivered ? { delivered } : {}),
      })),
      notStarted: started.notStarted,
    },
  };
}

async function activeTurn(context: SparkToolContext, action: StopSubChatAction) {
  const { rows } = await context.deps.db.query<{ run_id: string | null }>(
    `SELECT (SELECT r.id FROM runs r
             WHERE r.conversation_id = s.conversation_id AND r.parent_run_id IS NULL
               AND r.status IN ('queued', 'running', 'awaiting_approval')
             ORDER BY r.created_at DESC LIMIT 1) AS run_id
     FROM sub_chats s WHERE s.conversation_id = $1 AND s.parent_conversation_id = $2`,
    [action.subChat.id, action.parent.id],
  );
  if (!rows[0]) throw new Error(NOT_THIS_CHATS_SUB_CHAT);
  return rows[0].run_id;
}

export async function performStopSubChat(
  context: SparkToolContext,
  action: StopSubChatAction,
): Promise<Performed> {
  const { db } = context.deps;
  const runId = await activeTurn(context, action);
  if (!runId) return { message: `Nothing was running in “${action.subChat.title}”.`, url: null };
  await stopRun(db, runId);
  const payload = { event: 'turn_stopped', subChat: action.subChat, by: action.parent };
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: 'spark/sub_chat',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]).catch(() => undefined);
  return {
    message: `Stopped “${action.subChat.title}”.`,
    url: null,
    output: { conversationId: action.subChat.id, runId },
  };
}
