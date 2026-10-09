import {
  Role,
  taskStateToJSON,
  type Artifact,
  type Message,
  type Part,
  type StreamResponse,
  type Task,
  type TaskState,
  type TaskStatusUpdateEvent,
} from '@a2a-js/sdk';
import { requestState, type OutpostAnswer } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { PostWithFacts, TaskView } from '../outposts/ports.ts';
import { TEXT_MODE } from './agent-card.ts';
import { fromA2aState, toA2aState } from './task-states.ts';

export function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    mediaType: TEXT_MODE,
    filename: '',
    metadata: undefined,
  };
}

export function messageText(message: Message): string | null {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.content?.$case !== 'text') return null;
    texts.push(part.content.value);
  }
  return texts.join('\n');
}

interface MessageFacts {
  messageId: string;
  taskId: string;
  contextId: string;
  role: Role;
  text: string;
}

function textMessage(facts: MessageFacts): Message {
  return {
    messageId: facts.messageId,
    contextId: facts.contextId,
    taskId: facts.taskId,
    role: facts.role,
    parts: [textPart(facts.text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

export function requestMessage(request: {
  postId: string;
  outpostId: string;
  body: string;
}): Message {
  return textMessage({
    messageId: request.postId,
    contextId: request.outpostId,
    taskId: '',
    role: Role.ROLE_USER,
    text: request.body,
  });
}

function textArtifact(artifactId: string, name: string, text: string): Artifact {
  return {
    artifactId,
    name,
    description: '',
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
  };
}

function answerArtifacts(answer: OutpostAnswer | null): Artifact[] {
  if (answer === null) return [];
  const artifacts: Artifact[] = [];
  if (answer.branch !== null) {
    artifacts.push(textArtifact('branch', 'Branch', redactText(answer.branch)));
  }
  if (answer.changes.length > 0) {
    artifacts.push(
      textArtifact('changes', 'Changed files', redactText(answer.changes.join('\n'))),
    );
  }
  if (answer.pullRequests.length > 0) {
    artifacts.push(
      textArtifact('pull-requests', 'Pull requests', redactText(answer.pullRequests.join('\n'))),
    );
  }
  return artifacts;
}

function statusText(
  state: TaskView['state'],
  reason: string | null,
  answer: OutpostAnswer | null,
): string | null {
  const replied = state === 'answered' || state === 'needs_you';
  if (replied && answer !== null) return redactText(answer.text);
  return reason;
}

export function toA2aTask({ post, facts }: PostWithFacts, answer: OutpostAnswer | null): Task {
  if (facts === null || post.taskId === null) {
    throw new Error(`Post ${post.id} is not an accepted request.`);
  }
  const taskId = post.taskId;
  const derived = requestState(facts);
  const state = toA2aState(derived.state, facts.closedState);
  const replied = derived.state === 'answered' || derived.state === 'needs_you';
  const text = statusText(derived.state, derived.reason, answer);
  const message =
    text === null
      ? undefined
      : textMessage({
          messageId: `${taskId}:${taskStateToJSON(state)}`,
          contextId: post.outpostId,
          taskId,
          role: Role.ROLE_AGENT,
          text,
        });
  return {
    id: taskId,
    contextId: post.outpostId,
    status: { state, message, timestamp: post.closedAt ?? undefined },
    artifacts: replied ? answerArtifacts(answer) : [],
    history: [
      {
        ...requestMessage({ postId: post.id, outpostId: post.outpostId, body: post.body }),
        taskId,
      },
    ],
    metadata: undefined,
  };
}

function stateOf(task: Task): TaskState {
  if (task.status === undefined) throw new Error(`Task ${task.id} has no status.`);
  return task.status.state;
}

function statusMessageText(task: Task): string | null {
  const message = task.status?.message;
  return message === undefined ? null : messageText(message);
}

export function statusEvent(before: Task, after: Task): TaskStatusUpdateEvent | null {
  const same =
    stateOf(before) === stateOf(after) && statusMessageText(before) === statusMessageText(after);
  if (same) return null;
  return {
    taskId: after.id,
    contextId: after.contextId,
    status: after.status,
    metadata: undefined,
  };
}

export function streamItems(before: Task, after: Task): StreamResponse[] {
  const status = statusEvent(before, after);
  if (status === null) return [];
  const known = new Set(before.artifacts.map((artifact) => artifact.artifactId));
  const artifacts: StreamResponse[] = after.artifacts
    .filter((artifact) => !known.has(artifact.artifactId))
    .map((artifact) => ({
      payload: {
        $case: 'artifactUpdate',
        value: {
          taskId: after.id,
          contextId: after.contextId,
          artifact,
          append: false,
          lastChunk: true,
          metadata: undefined,
        },
      },
    }));
  return [...artifacts, { payload: { $case: 'statusUpdate', value: status } }];
}

export function withHistoryLength(task: Task, historyLength: number | undefined): Task {
  if (historyLength === undefined) return task;
  const kept = historyLength <= 0 ? [] : task.history.slice(-historyLength);
  return { ...task, history: kept };
}

export function toTaskView(task: Task): TaskView {
  const state = fromA2aState(stateOf(task));
  return {
    taskId: task.id,
    state,
    reason: state === 'answered' ? null : statusMessageText(task),
  };
}
