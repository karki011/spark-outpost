import type {
  AgentCard,
  CancelTaskRequest,
  GetTaskRequest,
  Message,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
} from '@a2a-js/sdk';
import { TaskState } from '@a2a-js/sdk';
import {
  ContentTypeNotSupportedError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '@a2a-js/sdk/errors';
import type { A2ARequestHandler } from '@a2a-js/sdk/server';
import type { OutpostAnswer } from '@spark-outpost/contracts';
import { z } from 'zod';
import type { PostStore, PostWithFacts } from '../outposts/ports.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import {
  acceptTask,
  cancelTask,
  chatFacts,
  taskPost,
  type AcceptRefusal,
  type InboundRequest,
} from '../persistence/outpost-tasks.ts';
import { agentCard } from './agent-card.ts';
import { isFinished } from './task-states.ts';
import { messageText, streamItems, toA2aTask, withHistoryLength } from './task-view.ts';
import type { TaskWakes } from './task-wakes.ts';

export type ReadAnswer = (db: Queryable, request: PostWithFacts) => Promise<OutpostAnswer | null>;

export interface HandlerDeps {
  db: Db;
  baseUrl: string;
  getPost: PostStore['getPost'];
  readAnswer: ReadAnswer;
  drain: (conversationId: string) => Promise<unknown>;
  stopRun: (runId: string) => Promise<unknown>;
  wakes: TaskWakes;
}

type StreamEnd = 'when_finished' | 'when_finished_or_asking';

const uuid = z.uuid();

const REFUSALS: Record<AcceptRefusal, () => Error> = {
  no_chat: () => new UnsupportedOperationError('This chat does not take requests.'),
  no_outpost: () =>
    new UnsupportedOperationError('This chat is not in an outpost, so it takes no new requests.'),
  other_outpost: () =>
    new RequestMalformedError('contextId is not the outpost this request belongs to.'),
  other_chat: () => new RequestMalformedError('That message is not a request to this chat.'),
  id_taken: () => new RequestMalformedError('messageId is already used by another message.'),
  empty: () => new RequestMalformedError('The request has no text.'),
  too_long: () => new RequestMalformedError('The request text is too long.'),
  closed: () =>
    new UnsupportedOperationError('That request was closed before it reached this chat.'),
};

function isUuid(value: string): boolean {
  return uuid.safeParse(value).success;
}

function inboundRequest(params: SendMessageRequest): InboundRequest {
  const message = params.message;
  if (message === undefined) throw new RequestMalformedError('SendMessage needs a message.');
  if (message.taskId !== '') {
    throw new UnsupportedOperationError(
      'A task takes one message. A task that needs input is answered by the user in Spark.',
    );
  }
  if (params.configuration?.taskPushNotificationConfig !== undefined) {
    throw new PushNotificationNotSupportedError('Push notifications are not supported.');
  }
  const text = messageText(message);
  if (text === null) throw new ContentTypeNotSupportedError('Only text parts are accepted.');
  if (!isUuid(message.messageId)) throw new RequestMalformedError('messageId must be a UUID.');
  if (message.contextId !== '' && !isUuid(message.contextId)) {
    throw new RequestMalformedError('contextId must be a UUID.');
  }
  return {
    messageId: message.messageId,
    contextId: message.contextId === '' ? null : message.contextId,
    text,
  };
}

async function unsupported(operation: string): Promise<never> {
  throw new UnsupportedOperationError(`${operation} is not supported.`);
}

async function pushUnsupported(): Promise<never> {
  throw new PushNotificationNotSupportedError('Push notifications are not supported.');
}

function stateOf(task: Task): TaskState {
  return task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED;
}

function streamOver(task: Task, end: StreamEnd): boolean {
  const state = stateOf(task);
  if (isFinished(state)) return true;
  return end === 'when_finished_or_asking' && state === TaskState.TASK_STATE_INPUT_REQUIRED;
}

export function outpostRequestHandler(
  deps: HandlerDeps,
  chatId: string,
  signal: AbortSignal,
): A2ARequestHandler {
  const { db } = deps;

  async function readTask(postId: string): Promise<Task | null> {
    const stored = await deps.getPost(db, postId);
    if (!stored || stored.post.taskId === null || stored.facts === null) return null;
    return toA2aTask(stored, await deps.readAnswer(db, stored));
  }

  async function taskOfThisChat(taskId: string): Promise<Task> {
    const found = isUuid(taskId) ? await taskPost(db, taskId) : null;
    const task =
      found !== null && found.conversationId === chatId ? await readTask(found.postId) : null;
    if (task === null) throw new TaskNotFoundError('This chat has no such task.');
    return task;
  }

  async function startTurn(): Promise<void> {
    try {
      await deps.drain(chatId);
    } catch (error) {
      console.error(`Could not start the queued outpost request for chat ${chatId}`, error);
    }
  }

  async function accept(params: SendMessageRequest): Promise<Task> {
    const outcome = await acceptTask(db, chatId, inboundRequest(params));
    if (outcome.kind === 'refused') throw REFUSALS[outcome.why]();
    if (outcome.kind === 'accepted' && outcome.queued) await startTurn();
    const task = await readTask(outcome.postId);
    if (task === null) throw new TaskNotFoundError('The request was removed.');
    return task;
  }

  async function* follow(first: Task, end: StreamEnd): AsyncGenerator<StreamResponse, void> {
    const found = await taskPost(db, first.id);
    let before = first;
    while (found !== null && !streamOver(before, end) && !signal.aborted) {
      const woken = deps.wakes.next(signal);
      const after = await readTask(found.postId);
      if (after === null) return;
      const items = streamItems(before, after);
      if (items.length === 0) {
        await woken;
        continue;
      }
      yield* items;
      before = after;
    }
  }

  return {
    async getAgentCard(): Promise<AgentCard> {
      const chat = await chatFacts(db, chatId);
      if (chat === null) throw new UnsupportedOperationError('This chat does not take requests.');
      return agentCard(chat, deps.baseUrl);
    },

    getAuthenticatedExtendedAgentCard: () => unsupported('The extended Agent Card'),

    async sendMessage(params): Promise<Message | Task> {
      return withHistoryLength(await accept(params), params.configuration?.historyLength);
    },

    async *sendMessageStream(params) {
      const task = await accept(params);
      yield { payload: { $case: 'task', value: task } };
      yield* follow(task, 'when_finished_or_asking');
    },

    async getTask(params: GetTaskRequest): Promise<Task> {
      return withHistoryLength(await taskOfThisChat(params.id), params.historyLength);
    },

    async cancelTask(params: CancelTaskRequest): Promise<Task> {
      await taskOfThisChat(params.id);
      const outcome = await cancelTask(db, params.id);
      if (outcome.kind === 'not_found') throw new TaskNotFoundError('This chat has no such task.');
      if (outcome.kind === 'finished') {
        throw new TaskNotCancelableError('The task has already finished.');
      }
      if (outcome.kind === 'stopping') await deps.stopRun(outcome.runId);
      return taskOfThisChat(params.id);
    },

    async *resubscribe(params: SubscribeToTaskRequest) {
      const task = await taskOfThisChat(params.id);
      if (isFinished(stateOf(task))) {
        throw new UnsupportedOperationError('The task has already finished.');
      }
      yield { payload: { $case: 'task', value: task } };
      yield* follow(task, 'when_finished');
    },

    listTasks: () => unsupported('ListTasks'),
    createTaskPushNotificationConfig: pushUnsupported,
    getTaskPushNotificationConfig: pushUnsupported,
    listTaskPushNotificationConfigs: pushUnsupported,
    deleteTaskPushNotificationConfig: pushUnsupported,
  };
}
