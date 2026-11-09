import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { createCommandTracker } from './command-output.ts';

function see(live: boolean, updates: SessionUpdate[]) {
  const tracker = createCommandTracker(live);
  return updates.flatMap((update) => tracker.see(update));
}

const delta = (id: string, data: string): SessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  _meta: { terminal_output_delta: { data, terminal_id: id } },
});

describe('command tracker', () => {
  it('keeps MCP execute calls out of terminal output for every provider', () => {
    for (const title of [
      'mcp.spark.spark_execute',
      'mcp__spark__spark_guide',
      'spark_docs',
      'mcp.github.get_issue',
    ]) {
      expect(
        see(false, [
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'mcp',
            title,
            kind: 'execute',
            status: 'in_progress',
          },
          { sessionUpdate: 'tool_call_update', toolCallId: 'mcp', status: 'completed' },
        ]),
      ).toEqual([]);
    }
  });

  it('reports a command an agent streams, with its folder, output and exit code', () => {
    const outputs = see(true, [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        kind: 'execute',
        title: 'npm test',
        status: 'in_progress',
        content: [{ type: 'terminal', terminalId: 'c1' }],
        rawInput: { command: "/bin/zsh -lc 'npm test'", cwd: '/repo/app' },
        _meta: { terminal_info: { cwd: '/repo/app', terminal_id: 'c1' } },
      },
      delta('c1', 'one\n'),
      delta('c1', 'two\n'),
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        status: 'failed',
        rawOutput: { formatted_output: 'one\ntwo\n', exit_code: 2 },
        _meta: { terminal_exit: { exit_code: 2, signal: null, terminal_id: 'c1' } },
      },
    ]);
    expect(outputs).toEqual([
      { kind: 'command_started', id: 'c1', command: 'npm test', cwd: '/repo/app', live: true },
      { kind: 'command_output', id: 'c1', data: 'one\n' },
      { kind: 'command_output', id: 'c1', data: 'two\n' },
      { kind: 'command_finished', id: 'c1', failed: true, exitCode: 2 },
    ]);
  });

  it("keeps Claude's description of a command as its title", () => {
    const outputs = see(true, [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        kind: 'execute',
        title: 'Terminal',
        rawInput: {},
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        title: 'git fetch origin',
        rawInput: { command: 'git fetch origin', description: ' Bring in the\n remote branch ' },
      },
    ]);
    expect(outputs).toEqual([
      {
        kind: 'command_started',
        id: 'c1',
        command: 'git fetch origin',
        description: 'Bring in the remote branch',
        cwd: null,
        live: true,
      },
    ]);
  });

  it('sends a description that arrives after the streamed command', () => {
    const outputs = see(false, [
      { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'execute', title: 'Terminal' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        title: 'git diff --stat HEAD',
        rawInput: { command: 'git diff --stat HEAD' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        title: 'git diff --stat HEAD',
        rawInput: { command: 'git diff --stat HEAD', description: 'Show the change summary' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        rawInput: { command: 'git diff --stat HEAD', description: 'Show the change summary' },
      },
    ]);
    expect(outputs).toEqual([
      {
        kind: 'command_started',
        id: 'c1',
        command: 'git diff --stat HEAD',
        cwd: null,
        live: false,
      },
      { kind: 'command_described', id: 'c1', description: 'Show the change summary' },
    ]);
  });

  it('leaves out a blank description', () => {
    const [started] = see(true, [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        kind: 'execute',
        title: 'ls',
        rawInput: { command: 'ls', description: '   ' },
      },
    ]);
    expect(started).not.toHaveProperty('description');
  });

  it('uses the whole output sent at the end when nothing was streamed', () => {
    const outputs = see(true, [
      { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'execute', title: 'ls' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        status: 'completed',
        rawOutput: { formatted_output: 'a\nb\n', exit_code: 0 },
        _meta: {
          terminal_output_delta: { data: 'a\nb\n', terminal_id: 'c1' },
          terminal_exit: { exit_code: 0, signal: null, terminal_id: 'c1' },
        },
      },
    ]);
    expect(outputs.slice(1)).toEqual([
      { kind: 'command_output', id: 'c1', data: 'a\nb\n' },
      { kind: 'command_finished', id: 'c1', failed: false, exitCode: 0 },
    ]);
  });

  it('treats a full-output update as a replacement', () => {
    const outputs = see(true, [
      { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'execute', title: 'ls' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        _meta: { terminal_output: { data: 'all of it', terminal_id: 'c1' } },
      },
    ]);
    expect(outputs[1]).toEqual({
      kind: 'command_output',
      id: 'c1',
      data: 'all of it',
      replace: true,
    });
  });

  it('waits for the command text when the first update only says Terminal', () => {
    const outputs = see(false, [
      { sessionUpdate: 'tool_call', toolCallId: 'b1', kind: 'execute', title: 'Terminal' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'b1', kind: 'execute' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'b1',
        kind: 'execute',
        title: 'npm run build',
        content: [{ type: 'content', content: { type: 'text', text: 'Builds the app' } }],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'b1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: '```console\nbuilt\n```' } }],
        rawOutput: 'built',
      },
    ]);
    expect(outputs).toEqual([
      { kind: 'command_started', id: 'b1', command: 'npm run build', cwd: null, live: false },
      { kind: 'command_output', id: 'b1', data: 'built' },
      { kind: 'command_finished', id: 'b1', failed: false, exitCode: null },
    ]);
  });

  it('reads the exit code a failed end-only result starts with', () => {
    const outputs = see(false, [
      { sessionUpdate: 'tool_call', toolCallId: 'b1', kind: 'execute', title: 'npm run lint' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'b1',
        status: 'failed',
        content: [
          { type: 'content', content: { type: 'text', text: '```\nExit code 3\n\nbad\n```' } },
        ],
      },
    ]);
    expect(outputs.slice(1)).toEqual([
      { kind: 'command_output', id: 'b1', data: 'bad' },
      { kind: 'command_finished', id: 'b1', failed: true, exitCode: 3 },
    ]);
  });

  it('still reports a command that ended before it was ever named', () => {
    const outputs = see(false, [
      { sessionUpdate: 'tool_call', toolCallId: 'b1', kind: 'execute', title: 'Terminal' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'b1', status: 'failed' },
    ]);
    expect(outputs).toEqual([
      { kind: 'command_started', id: 'b1', command: 'Command', cwd: null, live: false },
      { kind: 'command_finished', id: 'b1', failed: true, exitCode: null },
    ]);
  });

  it('ignores tools that are not commands and updates after the end', () => {
    const outputs = see(true, [
      { sessionUpdate: 'tool_call', toolCallId: 'r1', kind: 'read', title: 'Read a.ts' },
      delta('r1', 'file text'),
      { sessionUpdate: 'tool_call', toolCallId: 'c1', kind: 'execute', title: 'ls' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' },
      delta('c1', 'late'),
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
    ]);
    expect(outputs.map((output) => output.kind)).toEqual(['command_started', 'command_finished']);
  });
});
