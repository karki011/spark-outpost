import { Role, TaskState, type Task } from '@a2a-js/sdk';
import type { OutpostAnswer, RequestFacts } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import {
  messageText,
  requestMessage,
  statusEvent,
  streamItems,
  textPart,
  toA2aTask,
  toTaskView,
  withHistoryLength,
} from '../src/a2a/task-view.ts';
import type { PostWithFacts, StoredPost } from '../src/outposts/ports.ts';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const OUTPOST_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const CHAT_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

const post: StoredPost = {
  id: POST_ID,
  outpostId: OUTPOST_ID,
  kind: 'request',
  body: 'What does the orders endpoint return?',
  fromUser: true,
  fromConversationId: null,
  fromRunId: null,
  requestHash: null,
  waits: false,
  fromHandle: null,
  toHandle: 'api',
  toConversationId: CHAT_ID,
  guest: false,
  batchId: null,
  taskId: TASK_ID,
  runId: null,
  closedState: null,
  closedReason: null,
  closedAt: null,
  observed: [],
  answerSeenAt: null,
  pinnedAt: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  attachmentIds: [],
  opening: false,
};

const waiting: RequestFacts = {
  toHandle: 'api',
  closedState: null,
  closedReason: null,
  sent: true,
  queued: true,
  runStatus: null,
  runNeedsYou: null,
  paused: false,
  held: false,
  chatDeleted: false,
};

const answer: OutpostAnswer = {
  text: 'It returns { id, total }.',
  branch: 'spark/orders-shape',
  changes: ['src/orders.ts', 'docs/orders.md'],
  pullRequests: ['https://github.com/acme/api/pull/7'],
};

function request(facts: Partial<RequestFacts>, stored: Partial<StoredPost> = {}): PostWithFacts {
  return { post: { ...post, ...stored }, facts: { ...waiting, ...facts } };
}

function statusOf(task: Task) {
  return {
    state: task.status?.state,
    text: task.status?.message ? messageText(task.status.message) : null,
  };
}

describe('an A2A task built from a request', () => {
  it('carries the task id, the outpost as context and the request as history', () => {
    const task = toA2aTask(request({}), null);
    expect(task.id).toBe(TASK_ID);
    expect(task.contextId).toBe(OUTPOST_ID);
    expect(task.history).toEqual([
      {
        messageId: POST_ID,
        contextId: OUTPOST_ID,
        taskId: TASK_ID,
        role: Role.ROLE_USER,
        parts: [textPart('What does the orders endpoint return?')],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    ]);
    expect(task.artifacts).toEqual([]);
    expect(statusOf(task)).toEqual({ state: TaskState.TASK_STATE_SUBMITTED, text: null });
  });

  it('gives the answer as the status message of a completed task, with its artifacts', () => {
    const task = toA2aTask(request({ queued: false, runStatus: 'succeeded' }), answer);
    expect(statusOf(task)).toEqual({
      state: TaskState.TASK_STATE_COMPLETED,
      text: 'It returns { id, total }.',
    });
    expect(task.status?.message?.role).toBe(Role.ROLE_AGENT);
    expect(task.status?.message?.taskId).toBe(TASK_ID);
    expect(task.artifacts.map((artifact) => [artifact.artifactId, artifact.parts])).toEqual([
      ['branch', [textPart('spark/orders-shape')]],
      ['changes', [textPart('src/orders.ts\ndocs/orders.md')]],
      ['pull-requests', [textPart('https://github.com/acme/api/pull/7')]],
    ]);
  });

  it('leaves out artifacts the run did not produce', () => {
    const plain = { ...answer, branch: null, changes: [], pullRequests: [] };
    const task = toA2aTask(request({ queued: false, runStatus: 'succeeded' }), plain);
    expect(task.artifacts).toEqual([]);
  });

  it('reads a Needs you reply as input required and keeps the whole reply', () => {
    const reply = { ...answer, text: 'I can do either.\n\nNeeds you: v1 or v2?' };
    const facts = { queued: false, runStatus: 'succeeded', runNeedsYou: 'Needs you: v1 or v2?' };
    const task = toA2aTask(request(facts as Partial<RequestFacts>), reply);
    expect(statusOf(task)).toEqual({
      state: TaskState.TASK_STATE_INPUT_REQUIRED,
      text: 'I can do either.\n\nNeeds you: v1 or v2?',
    });
  });

  it('reads an approval card as input required and says who is waiting', () => {
    const task = toA2aTask(request({ queued: false, runStatus: 'awaiting_approval' }), null);
    expect(statusOf(task)).toEqual({
      state: TaskState.TASK_STATE_INPUT_REQUIRED,
      text: '@api is waiting for your approval',
    });
  });

  it('says why a request was not delivered and marks it rejected', () => {
    const closed = { closedState: 'rejected', closedReason: 'queue_full' } as const;
    const task = toA2aTask(
      request({ ...closed, queued: false }, { ...closed, closedAt: '2026-10-09T10:01:00.000Z' }),
      null,
    );
    expect(statusOf(task)).toEqual({
      state: TaskState.TASK_STATE_REJECTED,
      text: 'Not delivered: queue full',
    });
    expect(task.status?.timestamp).toBe('2026-10-09T10:01:00.000Z');
  });

  it('gives a failed or cancelled task no answer and no artifacts', () => {
    const failed = toA2aTask(request({ queued: false, runStatus: 'failed' }), answer);
    expect(statusOf(failed)).toEqual({
      state: TaskState.TASK_STATE_FAILED,
      text: "@api's turn failed",
    });
    expect(failed.artifacts).toEqual([]);
    const cancelled = toA2aTask(request({ queued: false, runStatus: 'cancelled' }), answer);
    expect(statusOf(cancelled)).toEqual({ state: TaskState.TASK_STATE_CANCELED, text: null });
  });

  it('redacts a secret in the answer and in its artifacts', () => {
    const leaky = {
      ...answer,
      text: `The token is ${SECRET}.`,
      changes: [`notes/${SECRET}.txt`],
    };
    const task = toA2aTask(request({ queued: false, runStatus: 'succeeded' }), leaky);
    expect(JSON.stringify(task)).not.toContain(SECRET);
    expect(statusOf(task).text).toContain('[redacted:');
  });

  it('refuses to build a task for a note or for a request nobody accepted', () => {
    expect(() => toA2aTask({ post: { ...post, kind: 'note' }, facts: null }, null)).toThrow(
      /not an accepted request/,
    );
    expect(() => toA2aTask(request({}, { taskId: null }), null)).toThrow(/not an accepted/);
  });
});

describe('stream items between two readings of a task', () => {
  const submitted = toA2aTask(request({}), null);
  const working = toA2aTask(request({ queued: false, runStatus: 'running' }), null);
  const completed = toA2aTask(request({ queued: false, runStatus: 'succeeded' }), answer);

  it('sends nothing when neither the state nor its message changed', () => {
    expect(statusEvent(submitted, toA2aTask(request({}), null))).toBeNull();
    expect(streamItems(submitted, submitted)).toEqual([]);
  });

  it('sends one status update when the state changes', () => {
    expect(statusEvent(submitted, working)).toEqual({
      taskId: TASK_ID,
      contextId: OUTPOST_ID,
      status: working.status,
      metadata: undefined,
    });
    expect(streamItems(submitted, working).map((item) => item.payload?.$case)).toEqual([
      'statusUpdate',
    ]);
  });

  it('sends a status update when only the reason changes', () => {
    const paused = toA2aTask(request({ paused: true }), null);
    expect(statusEvent(submitted, paused)?.status?.state).toBe(TaskState.TASK_STATE_SUBMITTED);
    expect(statusOf(paused).text).toBe('Paused');
  });

  it('sends each new artifact before the status update that completes the task', () => {
    const items = streamItems(working, completed);
    expect(items.map((item) => item.payload?.$case)).toEqual([
      'artifactUpdate',
      'artifactUpdate',
      'artifactUpdate',
      'statusUpdate',
    ]);
    const first = items[0]?.payload;
    expect(first?.$case === 'artifactUpdate' && first.value.artifact?.artifactId).toBe('branch');
    expect(first?.$case === 'artifactUpdate' && first.value.lastChunk).toBe(true);
  });
});

describe('helpers around a task', () => {
  it('reads a task back as the view the rest of Spark uses', () => {
    const completed = toA2aTask(request({ queued: false, runStatus: 'succeeded' }), answer);
    expect(toTaskView(completed)).toEqual({ taskId: TASK_ID, state: 'answered', reason: null });
    const rejected = toA2aTask(
      request({ closedState: 'rejected', closedReason: 'chat_archived', queued: false }),
      null,
    );
    expect(toTaskView(rejected)).toEqual({
      taskId: TASK_ID,
      state: 'failed',
      reason: 'Not delivered: chat archived',
    });
    expect(toTaskView(toA2aTask(request({}), null))).toEqual({
      taskId: TASK_ID,
      state: 'sent',
      reason: null,
    });
  });

  it('refuses to read a task with no status', () => {
    const task = { ...toA2aTask(request({}), null), status: undefined };
    expect(() => toTaskView(task)).toThrow(/no status/);
  });

  it('trims history to the length the caller asked for', () => {
    const task = toA2aTask(request({}), null);
    expect(withHistoryLength(task, undefined).history).toHaveLength(1);
    expect(withHistoryLength(task, 0).history).toEqual([]);
    expect(withHistoryLength(task, 5).history).toHaveLength(1);
  });

  it('builds the outgoing request message with the post id and no task id', () => {
    const message = requestMessage({ postId: POST_ID, outpostId: OUTPOST_ID, body: 'hello' });
    expect(message.messageId).toBe(POST_ID);
    expect(message.contextId).toBe(OUTPOST_ID);
    expect(message.taskId).toBe('');
    expect(message.role).toBe(Role.ROLE_USER);
    expect(messageText(message)).toBe('hello');
  });

  it('reads a message with a part that is not text as having no text', () => {
    const message = requestMessage({ postId: POST_ID, outpostId: OUTPOST_ID, body: 'hello' });
    const withData = {
      ...message,
      parts: [
        ...message.parts,
        { ...textPart(''), content: { $case: 'data' as const, value: { a: 1 } } },
      ],
    };
    expect(messageText(withData)).toBeNull();
  });
});
