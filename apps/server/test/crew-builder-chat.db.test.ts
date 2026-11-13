import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  remoteSwitchSchema,
  type BuilderChat,
  type ConversationSummary,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { pruneOldRows } from '../src/api/startup-prune.ts';
import { sweepBuilderChats } from '../src/crew-flows/builder-chat.ts';
import { crewEditRefusal, crewReadRefusal } from '../src/crew/tool-offer.ts';
import { insertFinishedRunEntries } from '../src/persistence/audit-log.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { remoteDecision } from '../src/remote/policy.ts';
import { chatPromptFacts } from '../src/workflow/chat-turn-prompt.ts';
import { chatPrompt } from '../src/workflow/chat-prompt.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;
let folders: string;

beforeEach(async () => {
  t = await createTestDb();
  folders = await mkdtemp(join(tmpdir(), 'spark-builder-'));
  client = localClient(createTestApp(t, { deleteSettleMs: 1_000 }));
});

afterEach(async () => {
  await t.cleanup();
  await rm(folders, { recursive: true, force: true });
});

const deps = () => ({ db: t.db, workspaceId: t.workspaceId, chatFolders: folders });

async function start(id = randomUUID()): Promise<BuilderChat> {
  return (await client.send('post', '/api/crew/builder', { id }).expect(201)).body as BuilderChat;
}

async function current(): Promise<BuilderChat | null> {
  return ((await client.get('/api/crew/builder').expect(200)).body as { chat: BuilderChat | null })
    .chat;
}

async function done(id: string): Promise<BuilderChat> {
  return (await client.send('post', `/api/crew/builder/${id}/done`, {}).expect(200))
    .body as BuilderChat;
}

async function say(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake' },
    t.workspaceId,
  );
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [sent.run.id]);
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    sent.run.id,
  ]);
  return sent.run.id;
}

async function doneHoursAgo(id: string, hours: number): Promise<void> {
  await t.db.query(
    `WITH old AS (SELECT done_at FROM crew_builder_chats WHERE conversation_id = $1),
     moved AS (
       UPDATE crew_builder_chats SET done_at = now() - make_interval(hours => $2)
       WHERE conversation_id = $1 RETURNING done_at
     )
     UPDATE messages m SET created_at = m.created_at - (old.done_at - moved.done_at)
     FROM old, moved WHERE m.conversation_id = $1 AND m.created_at <= old.done_at`,
    [id, hours],
  );
}

async function quietDaysAgo(id: string, days: number): Promise<void> {
  const ago = `now() - make_interval(days => ${days})`;
  await t.db.query(`UPDATE conversations SET created_at = ${ago} WHERE id = $1`, [id]);
  await t.db.query(`UPDATE messages SET created_at = ${ago} WHERE conversation_id = $1`, [id]);
  await t.db.query(
    `UPDATE runs SET created_at = ${ago}, started_at = ${ago}, finished_at = ${ago}
     WHERE conversation_id = $1`,
    [id],
  );
}

async function pendingCard(runId: string, sparkAction: unknown = null): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status)
     VALUES ($1, $2, $3, 'spark_action', 'New Spark', $4, 'sha256:x', '[]', 'pending')`,
    [id, runId, `call-${id}`, JSON.stringify(sparkAction ? { sparkAction } : {})],
  );
  return id;
}

const workflowEdit = (change: 'new' | 'changed') => ({
  action: 'crew_edit',
  target: 'workflow',
  id: 'pre-pr',
  name: 'Pre-PR review',
  files: [{ path: 'pre-pr.json', change, before: null, after: '{}', baseHash: null }],
});

async function audit(runId: string): Promise<void> {
  await insertFinishedRunEntries(t.db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: 'spark/crew_edit',
      rpcId: null,
      sizeBytes: 2,
      truncated: false,
      payload: {},
    },
  ]);
}

async function chatExists(id: string): Promise<boolean> {
  const { rowCount } = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [id]);
  return rowCount === 1;
}

async function chatFolder(id: string): Promise<string> {
  const folder = join(folders, id);
  await mkdir(folder, { recursive: true });
  return folder;
}

describe('builder chat', () => {
  it('starts one hidden chat per id and keeps it out of the chat list', async () => {
    const id = randomUUID();
    const first = await start(id);
    const again = await start(id);
    expect(again).toEqual(first);
    expect(first).toMatchObject({ conversationId: id, doneAt: null, removeAt: null });
    await say(id, 'Make a Spark that reviews docs');
    const listed = (await client.get('/api/conversations').expect(200))
      .body as ConversationSummary[];
    expect(listed.map((chat) => chat.id)).not.toContain(id);
    expect((await current())?.conversationId).toBe(id);
    const newer = await start();
    expect((await current())?.conversationId).toBe(newer.conversationId);
    const older = (await client.get(`/api/crew/builder?id=${id}`).expect(200)).body as {
      chat: BuilderChat;
    };
    expect(older.chat.conversationId).toBe(id);
    const { rows } = await t.db.query<{ kind: string }>(
      'SELECT kind FROM conversations WHERE id = $1',
      [id],
    );
    expect(rows[0]?.kind).toBe('crew');
  });

  it('refuses an id that belongs to an ordinary chat', async () => {
    const id = randomUUID();
    await say(id, 'Ordinary work');
    await client.send('post', '/api/crew/builder', { id }).expect(409);
  });

  it('marks Done once; a second Done keeps the first time', async () => {
    const { conversationId } = await start();
    await say(conversationId, 'Build a release Spark');
    const first = await done(conversationId);
    expect(first.doneAt).not.toBeNull();
    expect(Date.parse(first.removeAt!) - Date.parse(first.doneAt!)).toBe(24 * 3_600_000);
    await doneHoursAgo(conversationId, 2);
    const before = (await current())!.doneAt;
    const second = await done(conversationId);
    expect(second.doneAt).toBe(before);
  });

  it('reopens on a new message within 24 hours and can be done again', async () => {
    const { conversationId } = await start();
    await say(conversationId, 'Build a release Spark');
    await done(conversationId);
    await doneHoursAgo(conversationId, 3);
    await say(conversationId, 'One more change');
    expect((await current())?.doneAt).toBeNull();
    await doneHoursAgo(conversationId, 30);
    expect(await sweepBuilderChats(deps())).toEqual([]);
    expect((await done(conversationId)).doneAt).not.toBeNull();
  });

  it('is removed 24 hours after Done, keeping its audit until retention prunes it', async () => {
    const { conversationId } = await start();
    const runId = await say(conversationId, 'Build a release Spark');
    await audit(runId);
    const card = await pendingCard(runId);
    const folder = await chatFolder(conversationId);
    await done(conversationId);
    await doneHoursAgo(conversationId, 23);
    expect(await sweepBuilderChats(deps())).toEqual([]);
    await doneHoursAgo(conversationId, 25);
    expect(await sweepBuilderChats(deps())).toEqual([conversationId]);
    expect(await current()).toBeNull();
    expect(existsSync(folder)).toBe(false);
    await client.get(`/api/crew/builder?id=${conversationId}`).expect(404);
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM approvals WHERE id = $1',
      [card],
    );
    expect(rows[0]?.status).toBe('expired');
    expect(await chatExists(conversationId)).toBe(true);
    expect(await sweepBuilderChats(deps())).toEqual([]);
    expect(await chatExists(conversationId)).toBe(true);
    await t.db.query('DELETE FROM run_protocol_log WHERE run_id = $1', [runId]);
    await sweepBuilderChats(deps());
    expect(await chatExists(conversationId)).toBe(false);
  });

  it('is removed at the next start when Spark was closed past the 24 hours', async () => {
    const { conversationId } = await start();
    await say(conversationId, 'Build a release Spark');
    await done(conversationId);
    await doneHoursAgo(conversationId, 72);
    await pruneOldRows({ ...deps(), auditRetentionDays: 30, report: () => undefined });
    expect(await current()).toBeNull();
    expect(await chatExists(conversationId)).toBe(false);
  });

  it('removes one left without Done after the Archive inactive chats period', async () => {
    const { conversationId } = await start();
    await say(conversationId, 'Build a release Spark');
    await quietDaysAgo(conversationId, 1);
    expect(await sweepBuilderChats(deps())).toEqual([]);
    await quietDaysAgo(conversationId, 3);
    expect(await sweepBuilderChats(deps())).toEqual([conversationId]);
  });

  it('keeps an abandoned chat with a draft waiting, or when archiving is Never', async () => {
    const waiting = await start();
    await pendingCard(await say(waiting.conversationId, 'Draft a Spark'));
    await quietDaysAgo(waiting.conversationId, 10);
    const never = await start();
    await say(never.conversationId, 'Draft a Spark');
    await quietDaysAgo(never.conversationId, 10);
    await client.send('patch', '/api/profile', { archiveInactiveDays: null }).expect(200);
    expect(await sweepBuilderChats(deps())).toEqual([]);
    await client.send('patch', '/api/profile', { archiveInactiveDays: 2 }).expect(200);
    expect(await sweepBuilderChats(deps())).toEqual([never.conversationId]);
  });

  it('tells the agent what the chat is for and offers both crew tools', async () => {
    const { conversationId } = await start();
    const runId = await say(conversationId, 'Build a release Spark');
    const input = {
      identity: { threadId: conversationId, runId },
      workspaceId: t.workspaceId,
      projectRoots: [],
      level: 'hands-off',
      mode: 'do',
    } as unknown as RunInput;
    const facts = await chatPromptFacts(t.db, input);
    expect(facts.builderChat).toBe(true);
    expect(chatPrompt(facts)).toContain('Builder chat');
    const scope = { conversationId, runId, readOnly: false };
    expect(await crewReadRefusal(t.db, scope)).toBeNull();
    expect(await crewEditRefusal(t.db, scope)).toBeNull();
  });

  it('lists new Sparks and workflows waiting for the user as drafts', async () => {
    const { conversationId } = await start();
    const runId = await say(conversationId, 'Make a docs Spark and a review workflow');
    const spark = await pendingCard(runId, { action: 'create_teammate', name: 'Docs' });
    const flow = await pendingCard(runId, workflowEdit('new'));
    await pendingCard(runId, workflowEdit('changed'));
    const other = randomUUID();
    const elsewhere = await pendingCard(await say(other, 'Make a Spark'), {
      action: 'create_teammate',
      name: 'Release',
    });
    const { drafts } = (await client.get('/api/crew/drafts').expect(200)).body as {
      drafts: unknown[];
    };
    expect(drafts).toEqual([
      { approvalId: spark, conversationId, target: 'spark', name: 'Docs', inBuilder: true },
      {
        approvalId: flow,
        conversationId,
        target: 'workflow',
        name: 'Pre-PR review',
        inBuilder: true,
      },
      {
        approvalId: elsewhere,
        conversationId: other,
        target: 'spark',
        name: 'Release',
        inBuilder: false,
      },
    ]);
  });

  it('stays on the Mac', () => {
    const allOn = Object.fromEntries(
      remoteSwitchSchema.options.map((name) => [name, true]),
    ) as RemoteSwitches;
    for (const [method, path] of [
      ['GET', '/api/crew/builder'],
      ['POST', '/api/crew/builder'],
      ['POST', `/api/crew/builder/${randomUUID()}/done`],
      ['GET', '/api/crew/drafts'],
    ] as const) {
      expect(remoteDecision(method, path, allOn).kind).toBe('refuse');
    }
  });
});
