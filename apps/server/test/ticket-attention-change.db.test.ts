import { afterEach, beforeEach, expect, it } from 'vitest';
import { saveAttentionSnapshot, type FlaggedItem } from '../src/persistence/attention-settings.ts';
import { listen, type NotificationListener } from '../src/persistence/notifications.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let listener: NotificationListener;
let notified: Record<string, unknown>[];

beforeEach(async () => {
  t = await createTestDb();
  notified = [];
  listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    notified.push(JSON.parse(payload) as Record<string, unknown>);
  });
});

afterEach(async () => {
  await listener.close();
  await t.cleanup();
});

const item = (key: string): FlaggedItem => ({
  itemId: `linear:${key}`,
  key,
  title: `Ticket ${key}`,
  source: 'linear',
  status: 'In Review',
  priority: null,
  dueDate: null,
  project: null,
  pullRequest: null,
  flags: [{ rule: 'idle', text: 'idle for 3 days', days: 3 }],
});

it('announces a ticket change when the attention snapshot first gets items', async () => {
  await saveAttentionSnapshot(t.db, t.workspaceId, [item('ENG-1')]);
  const seen = await eventually(async () =>
    notified.some((event) => event.kind === 'ticket') ? notified : null,
  );
  expect(seen).toContainEqual({ kind: 'ticket', conversationId: null, runId: null });
});

it('stays quiet when a resync leaves the flagged set unchanged', async () => {
  await saveAttentionSnapshot(t.db, t.workspaceId, [item('ENG-1')]);
  await eventually(async () => (notified.some((event) => event.kind === 'ticket') ? true : null));
  notified.length = 0;

  await saveAttentionSnapshot(t.db, t.workspaceId, [item('ENG-1')]);
  await saveAttentionSnapshot(t.db, t.workspaceId, [item('ENG-2')]);
  const seen = await eventually(async () =>
    notified.some((event) => event.kind === 'ticket') ? notified : null,
  );
  expect(seen).toHaveLength(1);
});
