import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestState } from '@spark-outpost/contracts';
import { TaskWakes } from '../src/a2a/task-wakes.ts';
import { openWaits, waitForRequest } from '../src/outposts/request-wait.ts';
import { createOutpostRow, finishRun } from './outpost-fixtures.ts';
import { carry } from './outpost-store-support.ts';
import {
  chatAsk,
  memberWithTurn,
  outpostChanged,
  type MemberTurn,
} from './outpost-tool-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let web: MemberTurn;
let api: MemberTurn;
let wakes: TaskWakes;

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  web = await memberWithTurn(t, outpostId, 'web');
  api = await memberWithTurn(t, outpostId, 'api');
  wakes = new TaskWakes();
});

afterEach(async () => {
  await t.cleanup();
});

async function stateAfterWait(postId: string, signal: AbortSignal): Promise<string | null> {
  const found = await waitForRequest(t.db, wakes, postId, signal);
  return found?.facts ? requestState(found.facts).state : null;
}

describe('waiting for an outpost request', () => {
  it('returns at once when the request is already answered', async () => {
    const postId = await chatAsk(t, outpostId, web, api);
    await carry(t, postId, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'It returns orders.');
    expect(await stateAfterWait(postId, new AbortController().signal)).toBe('answered');
    expect(wakes.waiters).toBe(0);
  });

  it('holds while the request is sent or working and returns when it is answered', async () => {
    const postId = await chatAsk(t, outpostId, web, api);
    const waiting = stateAfterWait(postId, new AbortController().signal);
    await eventually(async () => wakes.waiters === 1);
    await carry(t, postId, api.runId);
    outpostChanged(wakes, outpostId);
    await eventually(async () => wakes.waiters === 1);
    await finishRun(t.db, api.runId, 'succeeded', 'It returns orders.');
    outpostChanged(wakes, outpostId);
    expect(await waiting).toBe('answered');
  });

  it('returns when the receiving turn needs the user', async () => {
    const postId = await chatAsk(t, outpostId, web, api);
    await carry(t, postId, api.runId);
    const waiting = stateAfterWait(postId, new AbortController().signal);
    await eventually(async () => wakes.waiters === 1);
    await t.db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash,
         options, status)
       VALUES ($1, $2, 'question', 'clarify', 'Pick a shape', '{}', 'sha256:card', '[]', 'pending')`,
      [randomUUID(), api.runId],
    );
    await t.db.query(`UPDATE runs SET status = 'awaiting_approval' WHERE id = $1`, [api.runId]);
    outpostChanged(wakes, outpostId);
    expect(await waiting).toBe('needs_you');
  });

  it('returns the request as it stands when the asking turn is stopped', async () => {
    const postId = await chatAsk(t, outpostId, web, api);
    await carry(t, postId, api.runId);
    const stop = new AbortController();
    const waiting = stateAfterWait(postId, stop.signal);
    await eventually(async () => wakes.waiters === 1);
    stop.abort();
    expect(await waiting).toBe('working');
    expect(wakes.waiters).toBe(0);
  });

  it('returns nothing when the request is gone', async () => {
    const postId = await chatAsk(t, outpostId, web, api);
    const waiting = waitForRequest(t.db, wakes, postId, new AbortController().signal);
    await eventually(async () => wakes.waiters === 1);
    await t.db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);
    outpostChanged(wakes, outpostId);
    expect(await waiting).toBeNull();
  });
});

describe('the open waits of an outpost', () => {
  it('lists a waiting request from a turn that is still running', async () => {
    await chatAsk(t, outpostId, web, api);
    expect(await openWaits(t.db, outpostId)).toEqual([
      { from: web.conversationId, to: api.conversationId },
    ]);
  });

  it('leaves out a request that does not wait', async () => {
    await chatAsk(t, outpostId, web, api, false);
    expect(await openWaits(t.db, outpostId)).toEqual([]);
  });

  it('leaves out a request whose asking turn has ended', async () => {
    await chatAsk(t, outpostId, web, api);
    await finishRun(t.db, web.runId, 'cancelled');
    expect(await openWaits(t.db, outpostId)).toEqual([]);
  });

  it('leaves out a request that was answered, needs the user or was cancelled', async () => {
    const answered = await chatAsk(t, outpostId, web, api);
    await carry(t, answered, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'Done.');
    const cancelled = await chatAsk(t, outpostId, api, web);
    await t.db.query(
      `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
      [cancelled],
    );
    expect(await openWaits(t.db, outpostId)).toEqual([]);
  });
});
