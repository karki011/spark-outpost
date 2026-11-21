import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertChatAsk, markChatAskDelivered } from '../src/persistence/chat-asks.ts';
import { getSummary } from '../src/persistence/conversations.ts';
import { getSubChat } from '../src/persistence/sub-chats.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { chatTarget } from '../src/workflow/queue-drain.ts';
import { turnsOf } from './chat-ask-fixtures.ts';
import { stackAtAutomatic, uncommitted, type Stack } from './stacked-sub-chat-fixtures.ts';
import { asksOf } from './sub-chat-report-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-sub-chat-record-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  await connectAgents(t);
});

afterEach(async () => {
  await t.cleanup();
});

function pass(): Promise<void> {
  return deliveryPass(t.db, chatTarget(t.db), {
    ship: {
      db: t.db,
      workspaceId: t.workspaceId,
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      locateGh: async () => null,
      branchPrefix: 'spark',
    },
  });
}

async function asTaskTurn(stack: Stack): Promise<{ api: string; runId: string }> {
  const api = stack.base.conversationId!;
  const [turn] = await turnsOf(t, api);
  const askId = randomUUID();
  await insertChatAsk(t.db, {
    id: askId,
    workspaceId: t.workspaceId,
    kind: 'task',
    fromConversationId: stack.parent,
    fromRunId: null,
    fromTitle: 'Parent',
    toConversationId: api,
    body: 'Build the API.',
    replyTo: null,
    wantsReply: true,
  });
  await markChatAskDelivered(t.db, askId, 'turn', turn!.id);
  await t.db.query('UPDATE sub_chats SET task_ask_id = $2 WHERE conversation_id = $1', [
    api,
    askId,
  ]);
  return { api, runId: turn!.id };
}

async function reportsTo(parent: string) {
  return asksOf(t, parent, 'report');
}

describe('the report of a sub-chat that kept changes', { timeout: 120_000 }, () => {
  it('reads Ready for review like its row, even before the turn’s kept record is written', async () => {
    const stack = await stackAtAutomatic(t, base, 'early');
    const { api, runId } = await asTaskTurn(stack);
    await t.db.query('DELETE FROM task_outcomes WHERE run_id = $1', [runId]);
    expect((await getSummary(t.db, api))?.subChat?.status).toBe('done');

    await pass();

    const [sent, ...more] = await reportsTo(stack.parent);
    expect(more).toEqual([]);
    expect(sent?.report?.status).toBe('ready_for_review');
    expect(sent?.body).toContain('Status: Ready for review');
    expect((await getSummary(t.db, api))?.subChat?.status).toBe('ready_for_review');
    expect((await getSubChat(t.db, api))?.report?.status).toBe('ready_for_review');
  });

  it('says committed once Spark has committed it for the sub-chat stacked on it', async () => {
    const stack = await stackAtAutomatic(t, base, 'stacked');
    const { api } = await asTaskTurn(stack);
    expect(uncommitted(stack.base)).not.toBe('');

    await pass();

    expect((await getSubChat(t.db, stack.web))?.startedAt).not.toBeNull();
    expect(uncommitted(stack.base)).toBe('');
    const [sent] = await reportsTo(stack.parent);
    expect(sent?.report).toMatchObject({ committed: true, pushed: false });
    expect(sent?.body).toContain(`branch ${stack.base.branch} · committed · not pushed`);
    expect(sent?.body).not.toContain('not committed');
    expect((await getSubChat(t.db, api))?.report).toMatchObject({ committed: true });
    const [turn, ...others] = await turnsOf(t, stack.parent);
    expect(others).toEqual([]);
    expect(turn?.user_message_id).toBe(sent?.id);
    const { rows } = await t.db.query<{ content: string }>(
      'SELECT content FROM messages WHERE id = $1',
      [sent!.id],
    );
    expect(rows[0]?.content).toContain('· committed · not pushed');

    const reportedAt = (await getSubChat(t.db, api))?.reportedAt;
    await pass();
    await pass();

    expect(await reportsTo(stack.parent)).toHaveLength(1);
    expect(await turnsOf(t, stack.parent)).toHaveLength(1);
    expect((await getSubChat(t.db, api))?.reportedAt).toEqual(reportedAt);
  });

  it('updates the block, not the delivered text, when the commit comes later', async () => {
    const stack = await stackAtAutomatic(t, base, 'later');
    await asTaskTurn(stack);
    const hook = path.join(stack.repo.root, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);

    await pass();

    const [told] = await reportsTo(stack.parent);
    expect(told?.report?.committed).toBe(false);
    expect(told?.body).toContain('not committed');
    await rm(hook);
    await pass();

    const [shown] = await reportsTo(stack.parent);
    expect(shown?.report?.committed).toBe(true);
    expect(shown?.body).toBe(told?.body);
  });
});
