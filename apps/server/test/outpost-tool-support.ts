import { randomUUID } from 'node:crypto';
import type { RunEvent } from '@spark-outpost/contracts';
import { TaskWakes } from '../src/a2a/task-wakes.ts';
import { insertPosts } from '../src/persistence/outpost-posts.ts';
import type { ProtocolObserver } from '../src/providers/provider.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import type { SparkToolContext } from '../src/spark-mcp/tool.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { deliverRequest, postRunId } from './outpost-fixtures.ts';
import { startChat, type TestDb } from './support.ts';

export interface MemberTurn {
  conversationId: string;
  runId: string;
  handle: string;
}

export async function memberWithTurn(
  t: TestDb,
  outpostId: string,
  handle: string,
): Promise<MemberTurn> {
  const chat = await startChat(t, `work in ${handle}`);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     SELECT $1, $2, $3, COALESCE(MAX(position), 0) + 1 FROM outpost_members WHERE outpost_id = $1`,
    [outpostId, chat.conversationId, handle],
  );
  await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [chat.runId]);
  return { ...chat, handle };
}

export async function chatAsk(
  t: TestDb,
  outpostId: string,
  from: MemberTurn,
  to: MemberTurn,
  waits = true,
): Promise<string> {
  const id = randomUUID();
  await insertPosts(t.db, [
    {
      id,
      outpostId,
      kind: 'request',
      body: `Question for @${to.handle}`,
      fromUser: false,
      fromConversationId: from.conversationId,
      fromHandle: from.handle,
      fromRunId: from.runId,
      requestHash: id,
      waits,
      toHandle: to.handle,
      toConversationId: to.conversationId,
    },
  ]);
  return id;
}

export function outpostChanged(wakes: TaskWakes, outpostId: string): void {
  wakes.changed({ kind: 'outpost_changed', conversationId: null, runId: null, outpostId });
}

export interface ToolHarness {
  context: SparkToolContext;
  wakes: TaskWakes;
  audited: { method: string; params: Record<string, unknown> }[];
  events: RunEvent[];
  stop: AbortController;
}

export function toolHarness(t: TestDb, turn: Pick<MemberTurn, 'conversationId' | 'runId'>) {
  const wakes = new TaskWakes();
  const audited: ToolHarness['audited'] = [];
  const events: RunEvent[] = [];
  const stop = new AbortController();
  const audit: ProtocolObserver = {
    message: (_direction, message) => {
      audited.push(message as ToolHarness['audited'][number]);
    },
    stderr: () => undefined,
  };
  const context: SparkToolContext = {
    deps: { db: t.db, outposts: { wakes } } as unknown as SparkToolDeps,
    scope: {
      workspaceId: t.workspaceId,
      conversationId: turn.conversationId,
      runId: turn.runId,
      actions: {
        append: async (event) => {
          events.push(event);
          return null;
        },
        waiters: new ApprovalWaiters(),
        signal: stop.signal,
        timeoutMs: 1_000,
        pollMs: 10,
        audit,
      },
    },
    signal: stop.signal,
  };
  return { context, wakes, audited, events, stop } satisfies ToolHarness;
}

export async function projectRow(t: TestDb, name: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
    [id, t.workspaceId, name, `/repos/${name}-${id}`],
  );
  return id;
}

export async function linkProject(
  t: TestDb,
  conversationId: string,
  projectId: string,
): Promise<void> {
  await t.db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [conversationId, projectId],
  );
}

export async function pieceRun(t: TestDb, parentRunId: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id, role)
     SELECT $1, conversation_id, user_message_id, provider, 'running', id, 'builder'
     FROM runs WHERE id = $2`,
    [id, parentRunId],
  );
  return id;
}

export type TurnStarter = 'user' | 'chat' | 'draft';

export async function requestStartedTurn(
  t: TestDb,
  outpostId: string,
  to: { conversationId: string; handle: string },
  starter: TurnStarter,
  from: MemberTurn | null = null,
): Promise<MemberTurn> {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: to.conversationId,
    toHandle: to.handle,
    fromUser: starter === 'user',
  });
  await t.db.query(
    `UPDATE outpost_posts SET from_conversation_id = $2, from_handle = $3, user_started = $4
     WHERE id = $1`,
    [postId, from?.conversationId ?? null, from?.handle ?? null, starter === 'draft'],
  );
  await drainQueue(t.db, to.conversationId, async () => ({ provider: 'fake' }));
  const runId = await postRunId(t.db, postId);
  if (runId === null) throw new Error('The request started no turn.');
  return { conversationId: to.conversationId, runId, handle: to.handle };
}
