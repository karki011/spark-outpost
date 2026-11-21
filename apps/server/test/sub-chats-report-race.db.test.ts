import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubChatReport } from '@spark-outpost/contracts';
import { rewriteReportAsk } from '../src/persistence/chat-asks.ts';
import { saveSubChatReport, saveSubChatReportRecord } from '../src/persistence/sub-chats.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import type { ReadBranchWork } from '../src/sub-chats/report-facts.ts';
import { refreshReportRecord } from '../src/sub-chats/reports.ts';
import { fakeTarget } from './chat-ask-fixtures.ts';
import { ownedWorktree } from './stack-support.ts';
import { addSubChat } from './sub-chat-fixtures.ts';
import { parentChat, projectAt, type ParentChat } from './sub-chat-plan-fixtures.ts';
import { asksOf, endTask, reportedAt, reportOn, startTask } from './sub-chat-report-fixtures.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const BRANCH = 'spark/orders-api';
const COMMITTED = { uncommitted: false, commits: true, pushed: false };
const RECORD = { branch: BRANCH, committed: true };

let t: TestDb;
let scratch: string;
let parent: ParentChat;
let api: string;
let first: SubChatReport;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-sub-chat-race-')));
  parent = await parentChat(t, await projectAt(t, scratch, 'shop'));
  const task = await startTask(t, await addSubChat(t, parent.id, 'Orders API'));
  api = task.id;
  await endTask(t, task);
  await deliveryPass(t.db, fakeTarget);
  await t.db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [api, parent.projectId],
  );
  const place = { conversationId: api, projectId: parent.projectId, root: parent.root };
  await ownedWorktree(t, place, BRANCH, 'main');
  first = (await reportOn(t, api))!;
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

function readingWhile(work: () => Promise<unknown>): ReadBranchWork {
  let reads = 0;
  return async () => {
    reads += 1;
    if (reads === 1) await work();
    return COMMITTED;
  };
}

describe('refreshing a report’s branch record', () => {
  it('writes the record Spark read onto the report and the report sent to the parent', async () => {
    expect(first.committed).toBe(false);

    expect(await refreshReportRecord(t.db, api, async () => COMMITTED)).toBe(true);

    expect(await reportOn(t, api)).toEqual({ ...first, ...RECORD });
    const [sent] = await asksOf(t, parent.id, 'report');
    expect(sent?.report).toEqual({ ...first, ...RECORD });
    expect(await refreshReportRecord(t.db, api, async () => COMMITTED)).toBe(false);
  });

  it('keeps a newer report saved between its read and its write', async () => {
    const newer = { ...first, changed: 'renamed the field.', risks: 'A migration is needed.' };
    const before = await reportedAt(t, api);
    const read = readingWhile(() => saveSubChatReport(t.db, api, newer));

    expect(await refreshReportRecord(t.db, api, read)).toBe(true);

    expect(await reportOn(t, api)).toEqual({ ...newer, ...RECORD });
    expect((await reportedAt(t, api))!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it('gives up cleanly when the sub-chat is deleted between its read and its write', async () => {
    const read = readingWhile(() => t.db.query('DELETE FROM conversations WHERE id = $1', [api]));

    expect(await refreshReportRecord(t.db, api, read)).toBe(false);

    expect(await reportOn(t, api)).toBeNull();
  });

  it('writes nothing over a row or a sent report that no longer holds what was read', async () => {
    const stale = { ...first, changed: 'An older snapshot.' };
    const [sent] = await asksOf(t, parent.id, 'report');
    const written = { ...stale, ...RECORD };

    expect(await saveSubChatReportRecord(t.db, api, stale, written)).toBe(false);
    expect(await rewriteReportAsk(t.db, sent!.id, stale, written, 'Rewritten.')).toBe(false);

    expect(await reportOn(t, api)).toEqual(first);
    const [kept] = await asksOf(t, parent.id, 'report');
    expect(kept).toMatchObject({ report: first, body: sent!.body });
  });

  it('still refreshes a report stored before Also said existed', async () => {
    await t.db.query(`UPDATE sub_chats SET report = report - 'said' WHERE conversation_id = $1`, [
      api,
    ]);

    expect(await refreshReportRecord(t.db, api, async () => COMMITTED)).toBe(true);

    expect(await reportOn(t, api)).toEqual({ ...first, ...RECORD, said: '' });
  });
});
