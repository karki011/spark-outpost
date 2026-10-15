import { CONTINUE_MESSAGE, type Run, type SendMessageResponse } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import {
  MessageConflictError,
  sendInTransaction,
  type RunTarget,
} from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import {
  InterruptionError,
  continueRefusal,
  interruptedState,
  recordChoice,
} from '../persistence/interruptions.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
} from '../persistence/provider-sessions.ts';
import {
  MESSAGE_COLUMNS,
  toMessage,
  toRun,
  type MessageRow,
  type RunRow,
} from '../persistence/rows.ts';

export const CONTINUE_METHOD = 'interruption/continue';
export const START_FRESH_METHOD = 'interruption/start_fresh';

async function lockConversation(client: Queryable, conversationId: string): Promise<void> {
  await client.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
}

async function auditChoice(db: Db, runId: string, method: string, payload: object): Promise<void> {
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

async function continuation(client: Queryable, runId: string): Promise<SendMessageResponse> {
  const run = await client.query<RunRow>('SELECT * FROM runs WHERE id = $1', [runId]);
  const message = await client.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`,
    [run.rows[0]!.user_message_id],
  );
  return { message: toMessage(message.rows[0]!), run: toRun(run.rows[0]!) };
}

export async function interruptedConversation(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<string> {
  return (await interruptedState(db, workspaceId, runId)).conversationId;
}

export async function continueInterruptedRun(
  db: Db,
  workspaceId: string,
  runId: string,
  messageId: string,
  target: RunTarget,
): Promise<SendMessageResponse> {
  const result = await withTransaction(db, async (client) => {
    const conversationId = await interruptedConversation(client, workspaceId, runId);
    await lockConversation(client, conversationId);
    const state = await interruptedState(client, workspaceId, runId);
    if (state.continuedBy) {
      return { sent: await continuation(client, state.continuedBy), created: false };
    }
    const refusal = continueRefusal(state);
    if (refusal) throw new InterruptionError(refusal);
    const sent = await sendInTransaction(
      client,
      conversationId,
      { id: messageId, content: CONTINUE_MESSAGE, source: 'ui', continuesRunId: runId },
      target,
    );
    if (sent.run.continuesRunId !== runId) throw new MessageConflictError(messageId);
    await recordChoice(client, runId, 'continue');
    return { sent, created: true };
  });
  if (result.created) {
    await auditChoice(db, runId, CONTINUE_METHOD, {
      choice: 'continue',
      by: 'user',
      continuedRunId: result.sent.run.id,
    });
  }
  return result.sent;
}

export async function startFreshAfterInterruption(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<Run> {
  const result = await withTransaction(db, async (client) => {
    const conversationId = await interruptedConversation(client, workspaceId, runId);
    await lockConversation(client, conversationId);
    const state = await interruptedState(client, workspaceId, runId);
    if (state.continuedBy) throw new InterruptionError('continued');
    if (state.status !== 'outcome_unknown' || state.role === 'digest') {
      throw new InterruptionError('not_interrupted');
    }
    const chosen = state.choice === null && !state.newerTurn;
    if (chosen) {
      await recordChoice(client, runId, 'fresh');
      await closeConversationSessions(
        client,
        workspaceId,
        conversationId,
        SESSION_CLOSE_REASONS.fresh,
      );
    }
    const run = await client.query<RunRow>('SELECT * FROM runs WHERE id = $1', [runId]);
    return { run: toRun(run.rows[0]!), chosen };
  });
  if (result.chosen) {
    await auditChoice(db, runId, START_FRESH_METHOD, { choice: 'fresh', by: 'user' });
  }
  return result.run;
}
