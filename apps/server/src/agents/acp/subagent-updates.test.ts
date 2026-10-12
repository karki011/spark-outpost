import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { THINKING_STEP } from './session-updates.ts';
import { createSubagentRouter } from './subagent-stream.ts';
import { createTurnMapper, SPAWN_STEP } from './subagent-updates.ts';

function harness() {
  const route = createSubagentRouter();
  const mapper = createTurnMapper('Fake', false);
  const send = (sessionId: string, update: Record<string, unknown>): ProviderOutput[] => {
    const message = route({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, update },
    });
    if (message === null) return [];
    const { params } = message as { params: { update: SessionUpdate } };
    return mapper.map(params.update);
  };
  const spawn = (parent: string, id: string) =>
    send(parent, {
      sessionUpdate: 'subagent_spawned',
      subagentSessionId: id,
      name: id,
      task: 'do',
    });
  const end = (parent: string, id: string, state = 'completed') =>
    send(parent, { sessionUpdate: 'subagent_state_update', subagentSessionId: id, state });
  const tool = (sessionId: string, toolCallId: string, title: string) =>
    send(sessionId, { sessionUpdate: 'tool_call', toolCallId, title, status: 'in_progress' });
  return { mapper, send, spawn, end, tool };
}

const kinds = (outputs: readonly ProviderOutput[]) => outputs.map((output) => output.kind);

describe('sub-agent updates', () => {
  it('records a spawn as a started sub-agent and a step that is not the main agent waiting', () => {
    const { spawn, mapper } = harness();
    expect(spawn('root', 'a')).toEqual([
      { kind: 'subagent_started', id: 'a', parentId: null, name: 'a', task: 'do' },
      { kind: 'step_started', name: SPAWN_STEP, tool: true, subagent: 'a' },
      { kind: 'step_finished', name: SPAWN_STEP, subagent: 'a' },
    ]);
    expect(spawn('root', 'a')).toEqual([]);
    expect(mapper.didWork()).toBe(true);
  });

  it("attributes a sub-agent's steps and tool calls to it", () => {
    const { spawn, tool } = harness();
    spawn('root', 'a');
    const outputs = tool('a', 't1', 'Read a.ts');
    expect(outputs).toContainEqual({
      kind: 'tool_started',
      id: 't1',
      name: 'Read a.ts',
      subagent: 'a',
    });
    expect(outputs).toContainEqual({
      kind: 'step_started',
      name: 'Read a.ts',
      tool: true,
      subagent: 'a',
    });
  });

  it("leaves the main agent's thinking open while a sub-agent uses a tool", () => {
    const { send, spawn, tool } = harness();
    spawn('root', 'a');
    send('root', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } });
    const outputs = tool('a', 't1', 'Read a.ts');
    expect(outputs).not.toContainEqual({ kind: 'step_finished', name: THINKING_STEP });
  });

  it('closes the open steps of a sub-agent when it ends', () => {
    const { spawn, tool, end } = harness();
    spawn('root', 'a');
    tool('a', 't1', 'Read a.ts');
    expect(end('root', 'a', 'failed')).toEqual([
      { kind: 'tool_input', id: 't1', input: null, secret: false },
      { kind: 'tool_result', id: 't1', output: null, secret: false },
      { kind: 'step_finished', name: 'Read a.ts', tool: true, subagent: 'a' },
      { kind: 'subagent_finished', id: 'a', state: 'failed' },
    ]);
    expect(end('root', 'a')).toEqual([]);
    expect(tool('a', 't2', 'Read b.ts')).toEqual([]);
  });

  it('names the parent of a nested sub-agent and adds no step for it', () => {
    const { spawn } = harness();
    spawn('root', 'a');
    expect(spawn('a', 'b')).toEqual([
      { kind: 'subagent_started', id: 'b', parentId: 'a', name: 'b', task: 'do' },
    ]);
  });

  it('closes the steps of sub-agents still working when the turn ends', () => {
    const { spawn, tool, mapper } = harness();
    spawn('root', 'a');
    tool('a', 't1', 'Read a.ts');
    expect(kinds(mapper.finish())).toEqual(['tool_input', 'tool_result', 'step_finished']);
  });
});
