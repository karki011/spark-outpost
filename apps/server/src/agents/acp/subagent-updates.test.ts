import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
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

  describe('a sub-agent that ends while a shell it started still runs', () => {
    const startShell = (send: ReturnType<typeof harness>['send']) => {
      send('root', { sessionUpdate: 'async_task_spawned', asyncTaskId: 't1', name: 'sleep 60' });
      send('a', {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'b1',
        status: 'completed',
        _meta: { claudeCode: { toolResponse: { backgroundTaskId: 't1' } } },
      });
    };
    const finished = (outputs: readonly ProviderOutput[]) =>
      outputs.filter((output) => output.kind === 'subagent_finished');

    it('stays running until the shell ends', () => {
      const { spawn, end, send } = harness();
      spawn('root', 'a');
      startShell(send);
      expect(finished(end('root', 'a'))).toEqual([]);
      const ended = send('root', {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 't1',
        state: 'completed',
      });
      expect(finished(ended)).toEqual([{ kind: 'subagent_finished', id: 'a', state: 'done' }]);
    });

    it('finishes before the generation that the shell wakes', () => {
      const { spawn, end, send } = harness();
      spawn('root', 'a');
      startShell(send);
      end('root', 'a');
      const woken = spawn('root', 'a:generation:2');
      expect(woken.map((output) => output.kind).slice(0, 2)).toEqual([
        'subagent_finished',
        'subagent_started',
      ]);
    });

    it('is stopped with the turn when the shell never ends', () => {
      const { mapper, spawn, end, send } = harness();
      spawn('root', 'a');
      startShell(send);
      end('root', 'a');
      expect(finished(mapper.finish(true))).toEqual([
        { kind: 'subagent_finished', id: 'a', state: 'cancelled' },
      ]);
    });

    it('finishes at once when its shell already ended', () => {
      const { spawn, end, send } = harness();
      spawn('root', 'a');
      startShell(send);
      send('root', {
        sessionUpdate: 'async_task_state_update',
        asyncTaskId: 't1',
        state: 'completed',
      });
      expect(finished(end('root', 'a'))).toEqual([
        { kind: 'subagent_finished', id: 'a', state: 'done' },
      ]);
    });
  });

  it('counts a Claude wait on background work as waiting before its input has streamed in', () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    const streamed = send('root', {
      sessionUpdate: 'tool_call',
      toolCallId: 'w3',
      title: 'TaskOutput',
      status: 'pending',
      rawInput: {},
      _meta: { claudeCode: { toolName: 'TaskOutput' } },
    });
    expect(streamed.filter((output) => 'waits' in output)).toHaveLength(1);
    const refined = send('root', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'w3',
      rawInput: { task_id: 'shell-9', block: true },
      _meta: { claudeCode: { toolName: 'TaskOutput' } },
    });
    expect(refined.some((output) => output.kind === 'step_started' && !('waits' in output))).toBe(
      false,
    );
    const ended = send('root', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'w3',
      status: 'completed',
    });
    expect(ended).toContainEqual(expect.objectContaining({ kind: 'step_finished', waits: true }));
  });

  it("counts other collaboration tools as the main agent's own work", () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
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

  it('reports the files a sub-agent changed and the commands it ran, once each', () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    const edit = (status: string) =>
      send('a', {
        sessionUpdate: status === 'in_progress' ? 'tool_call' : 'tool_call_update',
        toolCallId: 'e1',
        title: 'Edit a.ts',
        kind: 'edit',
        status,
        locations: [{ path: '/work/a.ts' }],
      });
    expect(edit('in_progress')).toContainEqual({
      kind: 'subagent_report',
      id: 'a',
      report: { files: ['/work/a.ts'] },
    });
    expect(edit('completed').some((output) => output.kind === 'subagent_report')).toBe(false);
    const run = send('a', {
      sessionUpdate: 'tool_call',
      toolCallId: 'x1',
      title: 'Terminal',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: ['pnpm', 'test'] },
    });
    expect(run).toContainEqual({
      kind: 'subagent_report',
      id: 'a',
      report: { commands: ['pnpm test'] },
    });
    const read = send('a', {
      sessionUpdate: 'tool_call',
      toolCallId: 'r1',
      title: 'Read b.ts',
      kind: 'read',
      status: 'in_progress',
      locations: [{ path: '/work/b.ts' }],
    });
    expect(read.some((output) => output.kind === 'subagent_report')).toBe(false);
  });

  it('ends a sub-agent with its last message, or with its hand-back when it used one', () => {
    const { spawn, send, end } = harness();
    spawn('root', 'a');
    spawn('root', 'b');
    const say = (id: string, messageId: string, text: string) =>
      send(id, {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text },
      });
    expect(say('a', 'm1', 'Looking. ')).toEqual([]);
    say('a', 'm2', 'Found 4 ');
    say('a', 'm2', 'routes.');
    expect(end('root', 'a')).toContainEqual({
      kind: 'subagent_report',
      id: 'a',
      report: { message: 'Found 4 routes.' },
    });
    say('b', 'm1', 'Plain words that are not delivered.');
    send('b', {
      sessionUpdate: 'tool_call',
      toolCallId: 'h1',
      title: 'SubagentHandback',
      status: 'in_progress',
      rawInput: { message: ' The full report. ' },
      _meta: { claudeCode: { toolName: 'SubagentHandback' } },
    });
    expect(end('root', 'b')).toContainEqual({
      kind: 'subagent_report',
      id: 'b',
      report: { message: 'The full report.' },
    });
  });

  it('keeps no summary for a sub-agent that delivered a report, also when it arrives later', () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    send('a', {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'The full report.' },
    });
    const ended = (summary: string) =>
      send('root', {
        sessionUpdate: 'subagent_state_update',
        subagentSessionId: 'a',
        state: 'completed',
        _meta: { claudeCode: { summary } },
      });
    expect(ended('Short summary')).toContainEqual({
      kind: 'subagent_report',
      id: 'a',
      report: { message: 'The full report.' },
    });
    expect(ended("This agent's report was delivered to you as a message. Read it there.")).toEqual(
      [],
    );
  });

  it('keeps the summary of a sub-agent that delivered no report', () => {
    const { spawn, send } = harness();
    spawn('root', 'a');
    const ended = send('root', {
      sessionUpdate: 'subagent_state_update',
      subagentSessionId: 'a',
      state: 'completed',
      _meta: { claudeCode: { summary: 'Found 4 routes' } },
    });
    expect(ended).toContainEqual({
      kind: 'subagent_report',
      id: 'a',
      report: { summary: 'Found 4 routes' },
    });
  });

  it('counts the tokens sub-agents reported once, also when the figures arrive after the end', () => {
    const { spawn, send, mapper } = harness();
    spawn('root', 'a');
    const ended = (tokens?: number) =>
      send('root', {
        sessionUpdate: 'subagent_state_update',
        subagentSessionId: 'a',
        state: 'completed',
        ...(tokens
          ? {
              _meta: {
                claudeCode: { usage: { total_tokens: tokens, tool_uses: 2, duration_ms: 900 } },
              },
            }
          : {}),
      });
    expect(ended().map((output) => output.kind)).toEqual(['subagent_finished']);
    expect(ended(1200)).toEqual([
      {
        kind: 'subagent_report',
        id: 'a',
        report: { usage: { tokens: 1200, toolUses: 2, durationMs: 900 } },
      },
    ]);
    ended(1500);
    expect(mapper.takeSubagentTokens()).toBe(1500);
    expect(mapper.takeSubagentTokens()).toBe(0);
  });

  it('counts only what a resumed generation added, since it reports the sub-agent’s running total', () => {
    const { spawn, send, mapper } = harness();
    const ended = (id: string, tokens: number) =>
      send('root', {
        sessionUpdate: 'subagent_state_update',
        subagentSessionId: id,
        state: 'completed',
        _meta: { claudeCode: { usage: { total_tokens: tokens, tool_uses: 4, duration_ms: 900 } } },
      });
    spawn('root', 'a');
    ended('a', 23_538);
    expect(mapper.takeSubagentTokens()).toBe(23_538);
    spawn('root', 'a:generation:2');
    ended('a:generation:2', 23_969);
    expect(mapper.takeSubagentTokens()).toBe(431);
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
