import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listen } from '../src/persistence/notifications.ts';
import { agentOpens, chatOnBranch, type TrackedChat } from './pr-tracking-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

interface ChangeEvent {
  kind: string;
  conversationId: string | null;
}

let t: TestDb;
let base: string;
let chat: TrackedChat;
let seen: ChangeEvent[];
let listener: Awaited<ReturnType<typeof listen>>;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-merged-events-')));
  chat = await chatOnBranch(t, base, 'widgets');
  await agentOpens(t, chat, 'https://github.com/acme/widgets/pull/7');
  seen = [];
  listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    seen.push(JSON.parse(payload) as ChangeEvent);
  });
});

afterEach(async () => {
  await listener.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

const saw = (kind: string, match: (event: ChangeEvent) => boolean) =>
  eventually(async () => seen.some((event) => event.kind === kind && match(event)));

describe('change events after every migration', () => {
  it('announces a line-count change on a chat’s pull request', async () => {
    const changed = await t.db.query(
      'UPDATE pr_watches SET additions = 12, deletions = 3 WHERE conversation_id = $1',
      [chat.conversationId],
    );
    expect(changed.rowCount).toBe(1);
    await saw('pull_request', (event) => event.conversationId === chat.conversationId);
  });

  it('keeps the pull request trigger and leaves no outpost trigger or function behind', async () => {
    const triggers = await t.db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN ('pr_watches'::regclass, 'runs'::regclass)`,
    );
    const names = triggers.rows.map((row) => row.tgname);
    expect(names).toContain('pr_watches_update_change');
    expect(names.filter((name) => name.includes('outpost'))).toEqual([]);
    const functions = await t.db.query(
      `SELECT 1 FROM pg_proc WHERE pronamespace = current_schema()::regnamespace
         AND proname LIKE '%outpost%'`,
    );
    expect(functions.rowCount).toBe(0);
  });
});
