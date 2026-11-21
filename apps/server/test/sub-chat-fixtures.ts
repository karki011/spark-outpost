import { randomUUID } from 'node:crypto';
import type { SubChatStartedWith } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { insertSubChat, type NewSubChat } from '../src/persistence/sub-chats.ts';
import type { TestDb } from './support.ts';

export const STARTED_WITH: SubChatStartedWith = {
  provider: 'fake',
  model: 'sonnet',
  effort: 'medium',
  agentMode: 'auto',
  level: 'full-auto',
};

export async function emptyChat(t: TestDb, title: string): Promise<string> {
  const id = randomUUID();
  await t.db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
    id,
    t.workspaceId,
    title,
  ]);
  return id;
}

export async function addSubChat(
  t: TestDb,
  parentConversationId: string,
  title: string,
  plan: Partial<Pick<NewSubChat, 'stackedOn' | 'startsAfter' | 'task'>> = {},
): Promise<string> {
  const conversationId = await emptyChat(t, title);
  await withTransaction(t.db, (client) =>
    insertSubChat(client, {
      conversationId,
      parentConversationId,
      task: plan.task ?? `Build ${title}.`,
      stackedOn: plan.stackedOn ?? null,
      startsAfter: plan.startsAfter ?? [],
      startedWith: STARTED_WITH,
      approvalId: null,
    }),
  );
  return conversationId;
}

export type TurnStatus = 'succeeded' | 'failed' | 'cancelled' | 'running';

export async function turnIn(
  t: TestDb,
  conversationId: string,
  status: TurnStatus,
): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'Go on.' },
    { provider: 'fake' },
  );
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [sent.run.id]);
  await t.db.query(
    `UPDATE runs SET status = $2, finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE now() END,
       error = CASE WHEN $2 = 'failed' THEN 'The agent crashed.' END
     WHERE id = $1`,
    [sent.run.id, status],
  );
  return sent.run.id;
}

export async function addPullRequest(
  t: TestDb,
  conversationId: string,
  state: 'open' | 'merged' | 'closed',
  number: number,
): Promise<void> {
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, pr_state, checks)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'shop', $4, $5, 'spark/piece', $6, 'passing')`,
    [
      randomUUID(),
      t.workspaceId,
      conversationId,
      number,
      `https://github.com/acme/shop/pull/${number}`,
      state,
    ],
  );
}
