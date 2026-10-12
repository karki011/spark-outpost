import * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { objectFields } from './object-fields.ts';

export const SUBAGENT_SESSIONS_CAPABILITY = 'nativeSubagentSessions';

const MARK_KEY = 'sparkSubagent';

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
  }),
  z.object({ event: z.literal('update'), id: z.string().min(1) }),
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

const updateSchema = z.looseObject({
  method: z.literal(acp.methods.client.session.update),
  params: z.looseObject({
    sessionId: z.string(),
    update: z.looseObject({ sessionUpdate: z.string() }),
  }),
});

type UpdateMessage = z.infer<typeof updateSchema>;

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

function unmarked(update: UpdateMessage['params']['update']): UpdateMessage['params']['update'] {
  const meta = Object.fromEntries(
    Object.entries(objectFields(update._meta)).filter(([key]) => key !== MARK_KEY),
  );
  return { ...update, _meta: meta };
}

export function createSubagentRouter(): (message: unknown) => unknown {
  const parents = new Map<string, string>();
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
      return control(parsed.data, rootOf(sessionId), { event: 'ended', id, state });
    }
    if (!parents.has(sessionId)) {
      return MARK_KEY in objectFields(update._meta)
        ? { ...parsed.data, params: { ...parsed.data.params, update: unmarked(update) } }
        : message;
    }
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
      return null;
    }
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
