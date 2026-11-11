import * as acp from '@agentclientprotocol/sdk/unstable';
import { z } from 'zod';
import { objectFields } from './object-fields.ts';
import { subagentConfiguration } from './subagent-config.ts';
import { reportedByAdapter, reportedSchema } from './subagent-report.ts';

export const SUBAGENT_SESSIONS_CAPABILITY = 'nativeSubagentSessions';
export const ASYNC_TASKS_CAPABILITY = 'asyncTasks';

const MARK_KEY = 'sparkSubagent';
const ATTRIBUTED_UPDATES = new Set(['tool_call', 'tool_call_update', 'agent_message_chunk']);

const END_STATES = {
  completed: 'done',
  failed: 'failed',
  disconnected: 'failed',
  cancelled: 'cancelled',
} as const;

const markSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('spawned'),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    name: z.string(),
    task: z.string(),
  }),
  z.object({
    event: z.literal('ended'),
    id: z.string().min(1),
    state: z.enum(['done', 'failed', 'cancelled']),
    reported: reportedSchema.optional(),
  }),
  z.object({ event: z.literal('update'), id: z.string().min(1) }),
  z.object({
    event: z.literal('config'),
    id: z.string().min(1),
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
  z.object({
    event: z.literal('task'),
    id: z.string().min(1),
    ended: z.boolean(),
    name: z.string().optional(),
    turn: z.boolean().optional(),
  }),
]);
export type SubagentMark = z.infer<typeof markSchema>;

const spawnedSchema = z.object({
  subagentSessionId: z.string().min(1),
  name: z.string(),
  task: z.string(),
});

const stateSchema = z.object({
  subagentSessionId: z.string().min(1),
  state: z.string(),
});

const TASK_END_STATES = new Set(['completed', 'failed', 'stopped']);

const taskSchema = z.object({ asyncTaskId: z.string().min(1) });
const spawnedTaskSchema = taskSchema.extend({
  name: z.string().optional(),
  taskType: z.string().optional(),
});
const taskStateSchema = taskSchema.extend({ state: z.string() });

const updateSchema = z.looseObject({
  method: z.literal(acp.methods.client.session.update),
  params: z.looseObject({
    sessionId: z.string(),
    update: z.looseObject({ sessionUpdate: z.string() }),
  }),
});

type UpdateMessage = z.infer<typeof updateSchema>;

const TASK_PLACEHOLDER = 'Delegated task';

export function shownTask(task: string, name: string): string {
  const text = task.trim();
  return text === TASK_PLACEHOLDER || text === `${TASK_PLACEHOLDER} for ${name}` ? '' : text;
}

export function subagentMark(update: { _meta?: unknown }): SubagentMark | null {
  const parsed = markSchema.safeParse(objectFields(update._meta)[MARK_KEY]);
  return parsed.success ? parsed.data : null;
}

function control(message: UpdateMessage, sessionId: string, mark: SubagentMark): unknown {
  return {
    ...message,
    params: {
      sessionId,
      update: { sessionUpdate: 'session_info_update', _meta: { [MARK_KEY]: mark } },
    },
  };
}

function taskMark(
  update: UpdateMessage['params']['update'],
  turns: Set<string>,
): SubagentMark | null {
  if (update.sessionUpdate === 'async_task_spawned') {
    const spawned = spawnedTaskSchema.safeParse(update);
    if (!spawned.success) return null;
    const { asyncTaskId: id, name, taskType } = spawned.data;
    const turn = taskType === 'turn';
    if (turn) turns.add(id);
    return {
      event: 'task',
      id,
      ended: false,
      ...(name ? { name } : {}),
      ...(turn ? { turn } : {}),
    };
  }
  const changed = taskStateSchema.safeParse(update);
  if (update.sessionUpdate !== 'async_task_state_update' || !changed.success) return null;
  const id = changed.data.asyncTaskId;
  if (!TASK_END_STATES.has(changed.data.state)) return null;
  const turn = turns.delete(id);
  return { event: 'task', id, ended: true, ...(turn ? { turn } : {}) };
}

function unmarked(update: UpdateMessage['params']['update']): UpdateMessage['params']['update'] {
  const meta = Object.fromEntries(
    Object.entries(objectFields(update._meta)).filter(([key]) => key !== MARK_KEY),
  );
  return { ...update, _meta: meta };
}

function namesParentToolUse(update: UpdateMessage['params']['update']): boolean {
  return typeof objectFields(objectFields(update._meta).claudeCode).parentToolUseId === 'string';
}

export function createSubagentRouter(): (message: unknown) => unknown {
  const parents = new Map<string, string>();
  const turns = new Set<string>();
  const rootOf = (sessionId: string): string => {
    let current = sessionId;
    const seen = new Set<string>();
    while (parents.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parents.get(current)!;
    }
    return current;
  };
  return (message) => {
    const parsed = updateSchema.safeParse(message);
    if (!parsed.success) return message;
    const { sessionId, update } = parsed.data.params;
    if (update.sessionUpdate.startsWith('async_task_')) {
      const mark = taskMark(update, turns);
      return mark ? control(parsed.data, rootOf(sessionId), mark) : null;
    }
    if (update.sessionUpdate === 'subagent_spawned') {
      const spawned = spawnedSchema.safeParse(update);
      if (!spawned.success || spawned.data.subagentSessionId === sessionId) return null;
      const { subagentSessionId: id, name, task } = spawned.data;
      const parentId = parents.has(sessionId) ? sessionId : null;
      if (!parents.has(id)) parents.set(id, sessionId);
      return control(parsed.data, rootOf(sessionId), {
        event: 'spawned',
        id,
        parentId,
        name,
        task,
      });
    }
    if (update.sessionUpdate === 'subagent_state_update') {
      const ended = stateSchema.safeParse(update);
      if (!ended.success) return null;
      const state = END_STATES[ended.data.state as keyof typeof END_STATES];
      const id = ended.data.subagentSessionId;
      if (state === undefined || !parents.has(id)) return null;
      const reported = reportedByAdapter(update._meta);
      const mark: SubagentMark = { event: 'ended', id, state, ...(reported ? { reported } : {}) };
      return control(parsed.data, rootOf(sessionId), mark);
    }
    if (update.sessionUpdate === 'config_option_update' && parents.has(sessionId)) {
      const configuration = subagentConfiguration(update.configOptions);
      if (Object.keys(configuration).length === 0) return null;
      return control(parsed.data, rootOf(sessionId), {
        event: 'config',
        id: sessionId,
        ...configuration,
      });
    }
    if (update.sessionUpdate === 'config_option_update' && namesParentToolUse(update)) return null;
    if (!parents.has(sessionId)) {
      return MARK_KEY in objectFields(update._meta)
        ? { ...parsed.data, params: { ...parsed.data.params, update: unmarked(update) } }
        : message;
    }
    if (!ATTRIBUTED_UPDATES.has(update.sessionUpdate)) return null;
    const mark: SubagentMark = { event: 'update', id: sessionId };
    return {
      ...parsed.data,
      params: {
        ...parsed.data.params,
        sessionId: rootOf(sessionId),
        update: { ...update, _meta: { ...objectFields(update._meta), [MARK_KEY]: mark } },
      },
    };
  };
}

export function routeSubagents(stream: acp.Stream): acp.Stream {
  const route = createSubagentRouter();
  const readable = stream.readable.pipeThrough(
    new TransformStream<acp.AnyMessage, acp.AnyMessage>({
      transform(message, controller) {
        const routed = route(message);
        if (routed !== null) controller.enqueue(routed as acp.AnyMessage);
      },
    }),
  );
  return { readable, writable: stream.writable };
}
