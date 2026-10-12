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

  it("marks the main agent's wait for its sub-agents, so it is not counted as its own work", () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    const codexWait = send('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 'w1',
      title: 'wait',
      status: 'in_progress',
      _meta: { codex: { collaboration: { tool: 'wait' } } },
    });
    expect(codexWait).toContainEqual({
      kind: 'step_started',
      name: 'Waiting for sub-agents',
      tool: true,
      waits: true,
    });
    const ended = send('root', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'w1',
      status: 'completed',
    });
    expect(ended).toContainEqual({
      kind: 'step_finished',
      name: 'Waiting for sub-agents',
      tool: true,
      waits: true,
    });
    const claudeWait = send('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 'w2',
      title: 'TaskOutput',
      status: 'in_progress',
      rawInput: { task_id: 'a', block: true },
      _meta: { claudeCode: { toolName: 'TaskOutput' } },
    });
    expect(claudeWait.filter((output) => 'waits' in output)).toHaveLength(1);
  });

  it("counts a check on something that is not a sub-agent as the main agent's own work", () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    const shell = send('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 'w3',
      title: 'TaskOutput',
      status: 'in_progress',
      rawInput: { task_id: 'shell-9' },
      _meta: { claudeCode: { toolName: 'TaskOutput' } },
    });
    expect(shell.some((output) => 'waits' in output)).toBe(false);
    const other = send('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 'w4',
      title: 'sendInput',
      status: 'in_progress',
      _meta: { codex: { collaboration: { tool: 'sendInput' } } },
    });
    expect(other.some((output) => 'waits' in output)).toBe(false);
  });

  it("leaves out the adapter's placeholder for a task it was not given", () => {
    const { send } = harness();
    const spawned = (id: string, name: string, task: string) =>
      send('root', { sessionUpdate: 'subagent_spawned', subagentSessionId: id, name, task });
    expect(spawned('a', 'Explorer', 'Delegated task for Explorer')).toContainEqual(
      expect.objectContaining({ kind: 'subagent_started', id: 'a', task: '' }),
    );
    expect(spawned('b', 'Tests', 'Delegated task')).toContainEqual(
      expect.objectContaining({ kind: 'subagent_started', id: 'b', task: '' }),
    );
    expect(spawned('c', 'Docs', 'Delegated task for the docs team')).toContainEqual(
      expect.objectContaining({
        kind: 'subagent_started',
        id: 'c',
        task: 'Delegated task for the docs team',
      }),
    );
  });

  it('names the sub-agent that asks for permission and attributes the note about the answer', () => {
    const { spawn, mapper } = harness();
    spawn('root', 'a');
    expect(mapper.asker('a')).toEqual({ id: 'a', name: 'a' });
    expect(mapper.asker('root')).toBeNull();
    expect(mapper.note('Allowed: Edit a.ts', 'a')).toEqual([
      { kind: 'step_started', name: 'Allowed: Edit a.ts', subagent: 'a' },
      { kind: 'step_finished', name: 'Allowed: Edit a.ts', subagent: 'a' },
    ]);
    expect(mapper.note('Allowed: Edit a.ts')).toEqual([
      { kind: 'step_started', name: 'Allowed: Edit a.ts' },
      { kind: 'step_finished', name: 'Allowed: Edit a.ts' },
    ]);
  });

  it("gives a sub-agent's hand-back a plain label", () => {
    const { spawn, tool } = harness();
    spawn('root', 'a');
    expect(tool('a', 'h1', 'SubagentHandback')).toContainEqual(
      expect.objectContaining({ kind: 'step_started', name: 'Reporting back', subagent: 'a' }),
    );
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
