import { randomUUID } from 'node:crypto';
import { TaskState, type StreamResponse, type Task } from '@a2a-js/sdk';
import type { Client } from '@a2a-js/sdk/client';
import { TaskNotFoundError, UnsupportedOperationError } from '@a2a-js/sdk/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loopbackPeer } from '../src/a2a/peer-client.ts';
import { messageText, requestMessage } from '../src/a2a/task-view.ts';
import type { PeerAgent } from '../src/outposts/ports.ts';
import { getRun } from '../src/persistence/runs.ts';
import { LAUNCH_TOKEN, startA2a, type A2aHarness } from './a2a-harness.ts';
import {
  linkStartedRun,
  memberChat,
  outpostRow,
  postColumns,
  queueRows,
  replyRow,
  requestRow,
  setRunStatus,
} from './a2a-fixtures.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let a2a: A2aHarness;
let outpostId: string;
let api: string;
let client: Client;

beforeEach(async () => {
  t = await createTestDb();
  a2a = await startA2a(t);
  outpostId = await outpostRow(t);
  api = await memberChat(t, outpostId, 'api');
  client = await a2a.client(api);
});

afterEach(async () => {
  await a2a.close();
  await t.cleanup();
});

type Stream = AsyncGenerator<StreamResponse, void, undefined>;

function storedRequest(body = 'What does the orders endpoint return?'): Promise<string> {
  return requestRow(t.db, { outpostId, toConversationId: api, toHandle: 'api', body });
}

function sendParams(postId: string) {
  return {
    tenant: '',
    message: requestMessage({ postId, outpostId, body: 'text on the wire' }),
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      returnImmediately: true,
    },
    metadata: undefined,
  };
}

async function nextItem(stream: Stream): Promise<NonNullable<StreamResponse['payload']>> {
  const item = await stream.next();
  if (item.done || item.value.payload === undefined) throw new Error('The stream ended.');
  return item.value.payload;
}

async function firstTask(stream: Stream): Promise<Task> {
  const first = await nextItem(stream);
  if (first.$case !== 'task') throw new Error(`Expected a task first, got ${first.$case}.`);
  return first.value;
}

async function nextStatus(stream: Stream) {
  const item = await nextItem(stream);
  if (item.$case !== 'statusUpdate') throw new Error(`Expected a status, got ${item.$case}.`);
  return {
    state: item.value.status?.state,
    text: item.value.status?.message ? messageText(item.value.status.message) : null,
  };
}

async function startedRun(postId: string): Promise<string> {
  const runId = await linkStartedRun(t.db, postId);
  if (runId === null) throw new Error('The request did not start a turn.');
  return runId;
}

describe('SendStreamingMessage', () => {
  it('sends the task, then each state as the turn moves, and ends when it is answered', async () => {
    const postId = await storedRequest();
    const stream = client.sendMessageStream(sendParams(postId));
    const task = await firstTask(stream);
    expect(task.status?.state).toBe(TaskState.TASK_STATE_SUBMITTED);
    expect(task.id).toBe((await postColumns(t.db, postId))?.task_id);

    const runId = await startedRun(postId);
    await setRunStatus(t.db, runId, 'running');
    expect(await nextStatus(stream)).toEqual({ state: TaskState.TASK_STATE_WORKING, text: null });

    await replyRow(t.db, runId, 'It returns { id, total }.');
    await setRunStatus(t.db, runId, 'succeeded');
    expect(await nextStatus(stream)).toEqual({
      state: TaskState.TASK_STATE_COMPLETED,
      text: 'It returns { id, total }.',
    });
    expect((await stream.next()).done).toBe(true);
    expect(a2a.wakes.waiters).toBe(0);
  });

  it('ends when the turn needs the user', async () => {
    const postId = await storedRequest();
    const stream = client.sendMessageStream(sendParams(postId));
    await firstTask(stream);
    const runId = await startedRun(postId);
    await setRunStatus(t.db, runId, 'awaiting_approval');
    expect((await nextStatus(stream)).state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect((await stream.next()).done).toBe(true);
  });

  it('sends a rejected task and ends at once', async () => {
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [api]);
    const stream = client.sendMessageStream(sendParams(await storedRequest()));
    expect((await firstTask(stream)).status?.state).toBe(TaskState.TASK_STATE_REJECTED);
    expect((await stream.next()).done).toBe(true);
  });

  it('refuses a streamed message for an existing task before any item', async () => {
    const params = sendParams(await storedRequest());
    const stream = client.sendMessageStream({
      ...params,
      message: { ...params.message, taskId: randomUUID() },
    });
    await expect(stream.next()).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('stops waiting when the caller leaves', async () => {
    const leaving = new AbortController();
    const stream = client.sendMessageStream(sendParams(await storedRequest()), {
      signal: leaving.signal,
    });
    await firstTask(stream);
    await eventually(async () => a2a.wakes.waiters === 1);
    leaving.abort();
    await stream.next().catch(() => undefined);
    await eventually(async () => a2a.wakes.waiters === 0);
  });
});

describe('SubscribeToTask', () => {
  async function sent(): Promise<{ postId: string; task: Task; runId: string }> {
    const postId = await storedRequest();
    const task = await client.sendMessage(sendParams(postId));
    if (!('status' in task)) throw new Error('Expected a task.');
    return { postId, task, runId: await startedRun(postId) };
  }

  it('sends the task as it is now and follows it past Needs you to the end', async () => {
    const { task, runId } = await sent();
    await setRunStatus(t.db, runId, 'running');
    const stream = client.resubscribeTask({ tenant: '', id: task.id });
    expect((await firstTask(stream)).status?.state).toBe(TaskState.TASK_STATE_WORKING);

    await setRunStatus(t.db, runId, 'awaiting_approval');
    expect((await nextStatus(stream)).state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    await setRunStatus(t.db, runId, 'running');
    expect((await nextStatus(stream)).state).toBe(TaskState.TASK_STATE_WORKING);
    await setRunStatus(t.db, runId, 'failed');
    expect((await nextStatus(stream)).state).toBe(TaskState.TASK_STATE_FAILED);
    expect((await stream.next()).done).toBe(true);
  });

  it('reports a cancel made by another call', async () => {
    const { task } = await sent();
    const stream = client.resubscribeTask({ tenant: '', id: task.id });
    await firstTask(stream);
    await client.cancelTask({ tenant: '', id: task.id, metadata: undefined });
    expect((await nextStatus(stream)).state).toBe(TaskState.TASK_STATE_CANCELED);
    expect((await stream.next()).done).toBe(true);
  });

  it('refuses a finished task and an unknown one', async () => {
    const { task, runId } = await sent();
    await setRunStatus(t.db, runId, 'failed');
    await expect(client.resubscribeTask({ tenant: '', id: task.id }).next()).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    await expect(
      client.resubscribeTask({ tenant: '', id: randomUUID() }).next(),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});

describe('the loopback peer Spark’s own code uses', () => {
  let peer: PeerAgent;

  beforeEach(() => {
    peer = loopbackPeer(a2a.baseUrl, LAUNCH_TOKEN);
  });

  function outbound(postId: string, toConversationId = api) {
    return { postId, outpostId, toConversationId, body: 'What does the orders endpoint return?' };
  }

  it('sends a stored request and reads it back as Sent', async () => {
    const postId = await storedRequest();
    const outcome = await peer.send(outbound(postId));
    const taskId = (await postColumns(t.db, postId))?.task_id;
    expect(outcome).toEqual({ accepted: true, task: { taskId, state: 'sent', reason: null } });
    expect(await peer.send(outbound(postId))).toEqual(outcome);
    expect(await peer.get({ taskId: taskId!, conversationId: api })).toEqual(outcome.task);
    const { rows } = await t.db.query('SELECT 1 FROM runs WHERE conversation_id = $1', [api]);
    expect(rows).toHaveLength(1);
  });

  it('reports a request the chat did not take as not accepted, with the reason', async () => {
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [api]);
    const outcome = await peer.send(outbound(await storedRequest()));
    expect(outcome.accepted).toBe(false);
    expect(outcome.task).toMatchObject({
      state: 'failed',
      reason: 'Not delivered: chat archived',
    });
  });

  it('cancels a task and answers a second cancel with the state it already has', async () => {
    const postId = await storedRequest();
    const { task } = await peer.send(outbound(postId));
    const runId = await startedRun(postId);
    const ref = { taskId: task.taskId, conversationId: api };
    expect(await peer.cancel(ref)).toMatchObject({ state: 'cancelled' });
    expect((await getRun(t.db, runId))?.status).toBe('cancelled');
    expect(await peer.cancel(ref)).toMatchObject({ state: 'cancelled' });
    expect(await queueRows(t.db, api)).toEqual([]);
  });

  it('throws, so the request stays unsent, when the token is wrong or the chat is gone', async () => {
    const postId = await storedRequest();
    const stranger = loopbackPeer(a2a.baseUrl, 'wrong-token-0123456789abcdefghijklmnop');
    await expect(stranger.send(outbound(postId))).rejects.toThrow();
    await expect(peer.send(outbound(postId, randomUUID()))).rejects.toThrow();
    expect((await postColumns(t.db, postId))?.task_id).toBeNull();
    expect((await peer.send(outbound(postId))).accepted).toBe(true);
  });
});
