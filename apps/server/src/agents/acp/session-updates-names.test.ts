import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { createUpdateMapper } from './session-updates.ts';

type ToolCallShape = Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>;
type ToolCallUpdateShape = Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>;

const call = (fields: Omit<ToolCallShape, 'sessionUpdate'>): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  ...fields,
});

const update = (fields: Omit<ToolCallUpdateShape, 'sessionUpdate'>): SessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  ...fields,
});

const stepNames = (outputs: readonly ProviderOutput[]) =>
  outputs.flatMap((output) =>
    output.kind === 'step_started' || output.kind === 'step_finished'
      ? [{ kind: output.kind, name: output.name, toolName: output.toolName }]
      : [],
  );

describe('ACP tool names on steps', () => {
  it('records the name from tool_call and keeps it when an update leaves it out', () => {
    const mapper = createUpdateMapper();
    const opened = mapper.map(
      call({
        toolCallId: 'read-1',
        name: 'Read',
        title: 'Read /repo/cart.js',
        kind: 'read',
        status: 'pending',
        locations: [{ path: '/repo/cart.js' }],
        rawInput: { file_path: '/repo/cart.js' },
      }),
    );
    const refined = mapper.map(
      update({ toolCallId: 'read-1', title: 'Read /repo/cart.js', name: null }),
    );
    const closed = mapper.map(update({ toolCallId: 'read-1', status: 'completed' }));
    expect(stepNames([...opened, ...refined, ...closed])).toEqual([
      { kind: 'step_started', name: 'Read `cart.js`', toolName: 'Read' },
      { kind: 'step_finished', name: 'Read `cart.js`', toolName: 'Read' },
    ]);
  });

  it('takes a name an update adds, and falls back to the Claude tool name in _meta', () => {
    const mapper = createUpdateMapper();
    mapper.map(
      call({
        toolCallId: 'mcp-1',
        title: 'mcp__github__create_issue',
        kind: 'other',
        status: 'pending',
      }),
    );
    mapper.map(update({ toolCallId: 'mcp-1', name: 'mcp__github__create_issue' }));
    const closed = mapper.map(update({ toolCallId: 'mcp-1', status: 'completed' }));
    expect(stepNames(closed)).toEqual([
      expect.objectContaining({ kind: 'step_finished', toolName: 'mcp__github__create_issue' }),
    ]);

    const fromMeta = mapper.map(
      call({
        toolCallId: 'grep-1',
        title: 'grep "total" src',
        kind: 'search',
        status: 'pending',
        _meta: { claudeCode: { toolName: 'Grep' } },
      }),
    );
    expect(stepNames(fromMeta)).toEqual([expect.objectContaining({ toolName: 'Grep' })]);
  });

  it('leaves steps without a name as they were', () => {
    const mapper = createUpdateMapper();
    const outputs = mapper.map(
      call({ toolCallId: 'x', title: 'Editing files', kind: 'edit', status: 'in_progress' }),
    );
    expect(outputs.find((output) => output.kind === 'step_started')).not.toHaveProperty('toolName');
  });

  it('carries the names codex-acp 1.13.1 sends, and none where it sends none', () => {
    const mapper = createUpdateMapper();
    const shell = mapper.map(
      call({
        toolCallId: 'c1',
        name: 'exec_command',
        kind: 'read',
        title: "Read file 'src/a.ts'",
        status: 'in_progress',
        locations: [{ path: 'src/a.ts' }],
      }),
    );
    const image = mapper.map(
      call({
        toolCallId: 'c2',
        kind: 'read',
        name: 'view_image',
        title: 'View Image shot.png',
        status: 'completed',
        locations: [{ path: 'shot.png' }],
        rawInput: { path: 'shot.png' },
      }),
    );
    const search = mapper.map(
      call({
        toolCallId: 'c3',
        kind: 'search',
        title: 'Web search',
        status: 'completed',
        rawInput: { query: 'acp' },
      }),
    );
    expect(stepNames(shell)[0]).toMatchObject({ toolName: 'exec_command' });
    expect(stepNames(image)[0]).toMatchObject({ toolName: 'view_image' });
    expect(stepNames(search)[0]).toMatchObject({ toolName: undefined });
  });
});
