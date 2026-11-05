import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionList, ConversationSummary } from '@spark-outpost/contracts';
import { recordShellAlert, type ShellAlert } from '../src/persistence/shell-alerts.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

async function shellItems(): Promise<AttentionItem[]> {
  const { items } = (await localClient(app).get('/api/attention').expect(200))
    .body as AttentionList;
  return items.filter((item) => item.kind === 'shell-alert');
}

async function summary(id: string): Promise<ConversationSummary> {
  const listed = (await localClient(app).get('/api/conversations').expect(200))
    .body as ConversationSummary[];
  return listed.find((chat) => chat.id === id)!;
}

async function chat(): Promise<string> {
  const { conversationId, runId } = await startChat(t, 'Build it');
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', started_at = now(), finished_at = now() WHERE id = $1`,
    [runId],
  );
  await t.db.query(`UPDATE conversations SET seen_at = now() WHERE id = $1`, [conversationId]);
  return conversationId;
}

function shellAlert(conversationId: string, message: string, shellId = 'shell-1'): ShellAlert {
  return { conversationId, shellId, label: '~/repo', message };
}

describe('shell tab alerts', () => {
  it('shows an alert as an update on the chat row that never blocks', async () => {
    const id = await chat();
    expect(await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'Build done'))).toBe(true);
    const [item] = await shellItems();
    expect(item).toMatchObject({
      kind: 'shell-alert',
      blocking: false,
      conversationId: id,
      detail: 'Build done',
      readAt: null,
    });
    expect(item?.key).toMatch(/^shell-alert:[0-9a-f-]{36}$/);
    const listed = await summary(id);
    expect(listed.shellAlert).toBe('Build done');
    expect(listed.attention).toBeNull();
  });

  it('keeps one alert per shell tab, with a new key for each new alert', async () => {
    const id = await chat();
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'first'));
    const [first] = await shellItems();
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'second'));
    const after = await shellItems();
    expect(after.map((item) => item.detail)).toEqual(['second']);
    expect(after[0]?.key).not.toBe(first?.key);
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'other tab', 'shell-2'));
    expect((await shellItems()).map((item) => item.detail).sort()).toEqual(['other tab', 'second']);
  });

  it('leaves the row and the list once the chat is read, and comes back only as a new alert', async () => {
    const id = await chat();
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'Tests passed'));
    await localClient(app).send('post', `/api/attention/chats/${id}/read`).expect(204);
    expect(await shellItems()).toEqual([]);
    expect((await summary(id)).shellAlert).toBeUndefined();
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'Tests failed'));
    expect((await shellItems()).map((item) => item.detail)).toEqual(['Tests failed']);
  });

  it('dismisses one alert by its key', async () => {
    const id = await chat();
    await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'Deploy finished'));
    const [item] = await shellItems();
    await localClient(app).send('post', `/api/attention/${item!.key}/dismiss`).expect(204);
    expect(await shellItems()).toEqual([]);
    expect((await summary(id)).shellAlert).toBeUndefined();
  });

  it('records nothing for a chat in another workspace, an archived chat or a missing chat', async () => {
    const id = await chat();
    await t.db.query(`UPDATE conversations SET archived_at = now() WHERE id = $1`, [id]);
    expect(await recordShellAlert(t.db, t.workspaceId, shellAlert(id, 'late'))).toBe(false);
    const other = await chat();
    const elsewhere = '22222222-2222-4222-8222-222222222222';
    expect(await recordShellAlert(t.db, elsewhere, shellAlert(other, 'wrong place'))).toBe(false);
    const missing = '33333333-3333-4333-8333-333333333333';
    expect(await recordShellAlert(t.db, t.workspaceId, shellAlert(missing, 'gone'))).toBe(false);
    expect(await shellItems()).toEqual([]);
  });
});
