import { describe, expect, it } from 'vitest';
import { createSubagentRouter, subagentMark } from './subagent-stream.ts';

const notify = (sessionId: string, update: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId, update },
});

const spawned = (parent: string, id: string) =>
  notify(parent, {
    sessionUpdate: 'subagent_spawned',
    subagentSessionId: id,
    name: `name ${id}`,
    task: `task ${id}`,
    capabilities: {},
  });

const ended = (parent: string, id: string, state: string) =>
  notify(parent, { sessionUpdate: 'subagent_state_update', subagentSessionId: id, state });

const toolCall = (sessionId: string, toolCallId: string) =>
  notify(sessionId, { sessionUpdate: 'tool_call', toolCallId, title: 'Read a.ts' });

function routed(message: unknown) {
  const { params } = message as ReturnType<typeof notify>;
  return { sessionId: params.sessionId, mark: subagentMark(params.update), update: params.update };
}

describe('sub-agent session routing', () => {
  it('passes other messages and root updates through untouched', () => {
    const route = createSubagentRouter();
    const request = { jsonrpc: '2.0', id: 1, method: 'session/request_permission', params: {} };
    const update = toolCall('root', 't1');
    expect(route(request)).toBe(request);
    expect(route(update)).toBe(update);
  });

  it('turns a spawn into a marked update on the root session', () => {
    const route = createSubagentRouter();
    const result = routed(route(spawned('root', 'a')));
    expect(result.sessionId).toBe('root');
    expect(result.update.sessionUpdate).toBe('session_info_update');
    expect(result.mark).toEqual({
      event: 'spawned',
      id: 'a',
      parentId: null,
      name: 'name a',
      task: 'task a',
    });
  });

  it("moves a sub-agent's tool calls to the root session and marks whose they are", () => {
    const route = createSubagentRouter();
    route(spawned('root', 'a'));
    const result = routed(route(toolCall('a', 't1')));
    expect(result.sessionId).toBe('root');
    expect(result.update).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 't1' });
    expect(result.mark).toEqual({ event: 'update', id: 'a' });
  });

  it('follows a nested sub-agent up to the root and names its parent', () => {
    const route = createSubagentRouter();
    route(spawned('root', 'a'));
    const nested = routed(route(spawned('a', 'b')));
    expect(nested.sessionId).toBe('root');
    expect(nested.mark).toMatchObject({ event: 'spawned', id: 'b', parentId: 'a' });
    expect(routed(route(toolCall('b', 't2')))).toMatchObject({
      sessionId: 'root',
      mark: { event: 'update', id: 'b' },
    });
  });

  it("drops a sub-agent's words, thoughts and settings", () => {
    const route = createSubagentRouter();
    route(spawned('root', 'a'));
    const said = notify('a', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    });
    expect(route(said)).toBeNull();
    expect(
      route(notify('a', { sessionUpdate: 'config_option_update', configOptions: [] })),
    ).toBeNull();
  });

  it.each([
    ['completed', 'done'],
    ['failed', 'failed'],
    ['disconnected', 'failed'],
    ['cancelled', 'cancelled'],
  ])('reports the %s state as %s', (state, shown) => {
    const route = createSubagentRouter();
    route(spawned('root', 'a'));
    expect(routed(route(ended('root', 'a', state))).mark).toEqual({
      event: 'ended',
      id: 'a',
      state: shown,
    });
  });

  it('drops a state it does not know, an unknown sub-agent and a malformed spawn', () => {
    const route = createSubagentRouter();
    route(spawned('root', 'a'));
    expect(route(ended('root', 'a', 'running'))).toBeNull();
    expect(route(ended('root', 'ghost', 'completed'))).toBeNull();
    expect(route(notify('root', { sessionUpdate: 'subagent_spawned', name: 'x' }))).toBeNull();
    expect(route(spawned('root', 'root'))).toBeNull();
  });

  it('removes a mark the agent wrote itself', () => {
    const route = createSubagentRouter();
    const forged = notify('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read',
      _meta: { sparkSubagent: { event: 'update', id: 'a' }, other: 1 },
    });
    const result = routed(route(forged));
    expect(result.mark).toBeNull();
    expect(result.update._meta).toEqual({ other: 1 });
  });
});
