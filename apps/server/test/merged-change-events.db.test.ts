import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listen } from '../src/persistence/notifications.ts';
import { createOutpostRow } from './outpost-fixtures.ts';
import { agentOpens, chatOnBranch, type TrackedChat } from './pr-tracking-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

interface ChangeEvent {
  kind: string;
  conversationId: string | null;
  outpostId?: string;
}

let t: TestDb;
let base: string;
let chat: TrackedChat;
let outpostId: string;
let seen: ChangeEvent[];
let listener: Awaited<ReturnType<typeof listen>>;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-merged-events-')));
  chat = await chatOnBranch(t, base, 'widgets');
  outpostId = await createOutpostRow(t);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, 'api', 1)`,
    [outpostId, chat.conversationId],
  );
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
  it('announces a line-count change on a pull request of an outpost member chat', async () => {
    const changed = await t.db.query(
      'UPDATE pr_watches SET additions = 12, deletions = 3 WHERE conversation_id = $1',
      [chat.conversationId],
    );
    expect(changed.rowCount).toBe(1);
    await saw('pull_request', (event) => event.conversationId === chat.conversationId);
  });

  it('announces the outpost when a member chat run changes status', async () => {
    seen.length = 0;
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [chat.runId]);
    await saw('outpost_changed', (event) => event.outpostId === outpostId);
  });

  it('keeps both sets of triggers', async () => {
    const { rows } = await t.db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN ('pr_watches'::regclass, 'runs'::regclass, 'outpost_posts'::regclass)`,
    );
    expect(rows.map((row) => row.tgname)).toEqual(
      expect.arrayContaining([
        'pr_watches_update_change',
        'runs_insert_outpost_change',
        'runs_status_outpost_change',
        'outpost_posts_insert_change',
        'outpost_posts_state_change',
      ]),
    );
  });
});
