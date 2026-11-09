import * as acp from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { approvalRequestFrom } from './permission-request.ts';
import { createToolCallMemory } from './tool-call-memory.ts';

const update = (fields: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  method: acp.methods.client.session.update,
  params: { sessionId: 's1', update: fields },
});

const permission = (toolCall: Record<string, unknown>, meta?: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 7,
  method: acp.methods.client.session.requestPermission,
  params: {
    sessionId: 's1',
    toolCall,
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
    ...(meta ? { _meta: meta } : {}),
  },
});

const context = { rpcId: '7', roots: [], cwd: '/work', home: '/home/me' };

function requestOf(message: unknown) {
  const params = (message as { params: acp.RequestPermissionRequest }).params;
  return approvalRequestFrom(params, context);
}

describe('a trimmed permission request from the Claude adapter', () => {
  it('takes the tool name and kind from the tool call announced before it', () => {
    const remember = createToolCallMemory();
    remember(
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Fetch http://127.0.0.2:9/status',
        kind: 'fetch',
        rawInput: { url: 'http://127.0.0.2:9/status' },
        _meta: { claudeCode: { toolName: 'WebFetch' } },
      }),
    );
    const request = requestOf(
      remember(
        permission({
          toolCallId: 't1',
          title: 'Fetch http://127.0.0.2:9/status',
          rawInput: { url: 'http://127.0.0.2:9/status' },
        }),
      ),
    );
    expect(request.address).toBe('http://127.0.0.2:9/status');
    expect(request.toolKind).toBe('fetch');
  });

  it('marks an edit as an edit and keeps the diff the tool call showed', () => {
    const remember = createToolCallMemory();
    const diff = { type: 'diff', path: '/work/a.txt', oldText: 'a', newText: 'b' };
    remember(
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't2',
        title: 'Edit a.txt',
        kind: 'edit',
        rawInput: { file_path: '/work/a.txt', old_string: 'a', new_string: 'b' },
        content: [diff],
        locations: [{ path: '/work/a.txt' }],
        _meta: { claudeCode: { toolName: 'Edit' } },
      }),
    );
    const request = requestOf(
      remember(
        permission({
          toolCallId: 't2',
          title: 'Edit a.txt',
          rawInput: { file_path: '/work/a.txt' },
        }),
      ),
    );
    expect(request.kind).toBe('edit');
    expect(request.paths).toEqual(['/work/a.txt']);
    expect(request.diffs).toEqual([{ path: '/work/a.txt', oldText: 'a', newText: 'b' }]);
  });

  it('never replaces what the request itself says', () => {
    const remember = createToolCallMemory();
    remember(
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't3',
        kind: 'read',
        rawInput: { command: 'old' },
        _meta: { claudeCode: { toolName: 'Read' } },
      }),
    );
    const request = requestOf(
      remember(
        permission({
          toolCallId: 't3',
          name: 'Bash',
          kind: 'execute',
          title: 'ls',
          rawInput: { command: 'ls' },
        }),
      ),
    );
    expect(request.kind).toBe('execute');
    expect(request.command).toBe('ls');
  });

  it('forgets a tool call once it has ended', () => {
    const remember = createToolCallMemory();
    remember(
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't4',
        kind: 'edit',
        _meta: { claudeCode: { toolName: 'Edit' } },
      }),
    );
    remember(update({ sessionUpdate: 'tool_call_update', toolCallId: 't4', status: 'completed' }));
    const request = requestOf(remember(permission({ toolCallId: 't4', title: 'Edit' })));
    expect(request.kind).toBe('other');
  });

  it('reads the agent’s reason from the AIR permission meta', () => {
    const request = requestOf(
      permission(
        { toolCallId: 't5', title: 'ls', kind: 'execute', rawInput: { command: 'ls' } },
        {
          jetbrains: {
            air: { permission: { version: 1, title: 'ls', description: 'Reason: lists files' } },
          },
        },
      ),
    );
    expect(request.agentReason).toBe('lists files');
  });
});

describe('a later report on a tool call', () => {
  it('names the tool when the adapter leaves the name out', () => {
    const remember = createToolCallMemory();
    remember(
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'w1',
        kind: 'other',
        _meta: { claudeCode: { toolName: 'ScheduleWakeup' } },
      }),
    );
    const done = remember(
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'w1', status: 'completed' }),
    ) as { params: { update: { _meta: { claudeCode: { toolName: string } } } } };
    expect(done.params.update._meta.claudeCode.toolName).toBe('ScheduleWakeup');
  });
});
