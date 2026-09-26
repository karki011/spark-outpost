import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { THINKING_STEP, createUpdateMapper, describeTool } from './session-updates.ts';

const link = (uri: string, name: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'resource_link', uri, name },
});

const text = (value: string, messageId?: string) =>
  ({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: value },
    ...(messageId ? { messageId } : {}),
  }) as const;

describe('ACP session update mapping', () => {
  it('turns thought chunks into one Thinking step that closes when text starts', () => {
    const mapper = createUpdateMapper();
    const thought = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'a' },
    } as const;
    expect(mapper.map(thought)).toEqual([{ kind: 'step_started', name: THINKING_STEP }]);
    expect(mapper.map(thought)).toEqual([]);
    expect(mapper.map(text('Hi'))).toEqual([
      { kind: 'step_finished', name: THINKING_STEP },
      { kind: 'text_delta', delta: 'Hi' },
    ]);
  });

  it('closes a tool step under the name it opened with, even when the title changes', () => {
    const mapper = createUpdateMapper();
    expect(
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 't',
        title: 'Preparing file…',
        status: 'pending',
      }),
    ).toEqual([{ kind: 'step_started', name: 'Preparing file…', tool: true }]);
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        title: 'Write a.txt',
        status: 'in_progress',
      }),
    ).toEqual([]);
    expect(
      mapper.map({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed' }),
    ).toEqual([
      { kind: 'step_finished', name: 'Preparing file…' },
      { kind: 'step_started', name: 'Failed: Preparing file…' },
      { kind: 'step_finished', name: 'Failed: Preparing file…' },
    ]);
    expect(mapper.didWork()).toBe(true);
  });

  it('separates text from different agent messages with a blank line', () => {
    const mapper = createUpdateMapper();
    const deltas = [text('One', 'a'), text(' more', 'a'), text('Two', 'b')].flatMap((update) =>
      mapper.map(update),
    );
    expect(
      deltas.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join(''),
    ).toBe('One more\n\nTwo');
  });

  it('remembers error notices and shows warnings as steps', () => {
    const mapper = createUpdateMapper();
    const notice = (severity: string) => ({
      sessionUpdate: 'session_info_update' as const,
      _meta: {
        jetbrains: {
          air: { sessionFailure: { severity, title: 'Stream lost', category: 'transport_lost' } },
        },
      },
    });
    expect(mapper.map(notice('warning'))).toEqual([
      { kind: 'step_started', name: 'Warning: Stream lost' },
      { kind: 'step_finished', name: 'Warning: Stream lost' },
    ]);
    expect(mapper.failure()).toBeNull();
    expect(mapper.map(notice('error'))).toEqual([]);
    expect(mapper.failure()).toEqual({ category: 'transport_lost', title: 'Stream lost' });
    expect(mapper.map({ sessionUpdate: 'session_info_update', title: 'Chat' })).toEqual([]);
  });

  it('shows notices as steps and treats error notices as the turn failure', () => {
    const mapper = createUpdateMapper();
    expect(
      mapper.map({ sessionUpdate: 'notice', severity: 'warning', title: 'Using HTTPS transport' }),
    ).toEqual([
      { kind: 'step_started', name: 'Warning: Using HTTPS transport' },
      { kind: 'step_finished', name: 'Warning: Using HTTPS transport' },
    ]);
    expect(mapper.map({ sessionUpdate: 'notice', severity: 'error', title: 'Boom' })).toEqual([]);
    expect(mapper.failure()).toEqual({ category: 'provider_error', title: 'Boom' });
  });

  it('reports context usage and USD cost', () => {
    const mapper = createUpdateMapper();
    expect(
      mapper.map({
        sessionUpdate: 'usage_update',
        used: 1200,
        size: 200000,
        cost: { amount: 0.05, currency: 'USD' },
      }),
    ).toEqual([{ kind: 'usage', contextUsed: 1200, contextSize: 200000, costUsd: 0.05 }]);
    expect(mapper.map({ sessionUpdate: 'usage_update', used: 1, size: 2 })).toEqual([
      { kind: 'usage', contextUsed: 1, contextSize: 2, costUsd: null },
    ]);
  });

  it('closes open steps when the turn finishes and ignores bookkeeping updates', () => {
    const mapper = createUpdateMapper();
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'x',
      title: 'Search',
      status: 'in_progress',
    });
    expect(
      mapper.map({ sessionUpdate: 'available_commands_update', availableCommands: [] }),
    ).toEqual([]);
    expect(mapper.finish()).toEqual([{ kind: 'step_finished', name: 'Search' }]);
    expect(mapper.finish()).toEqual([]);
  });

  it('shortens absolute paths in tool titles to file names, leaving code spans alone', () => {
    expect(describeTool('Read /private/tmp/run-1/src/FilterChips.tsx')).toBe(
      'Read `FilterChips.tsx`',
    );
    expect(describeTool('`ls /tmp/run-1`')).toBe('`ls /tmp/run-1`');
    expect(describeTool('  ')).toBe('Using a tool');
  });

  it('passes each plan through whole, with priority and in-progress status', () => {
    const mapper = createUpdateMapper();
    mapper.map({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'a' } });
    expect(
      mapper.map({
        sessionUpdate: 'plan',
        entries: [
          { content: '  Read the question ', priority: 'high', status: 'completed' },
          { content: '   ', priority: 'low', status: 'pending' },
          { content: 'Draft an answer', priority: 'low', status: 'in_progress' },
        ],
      }),
    ).toEqual([
      { kind: 'step_finished', name: THINKING_STEP },
      {
        kind: 'plan',
        entries: [
          { content: 'Read the question', priority: 'high', status: 'completed' },
          { content: 'Draft an answer', priority: 'low', status: 'in_progress' },
        ],
      },
    ]);
    expect(mapper.map({ sessionUpdate: 'plan', entries: [] })).toEqual([
      { kind: 'plan', entries: [] },
    ]);
    expect(mapper.finish()).toEqual([]);
  });

  it('captures pull request links from tool output, resource links and raw output once', () => {
    const mapper = createUpdateMapper();
    const pr = 'https://github.com/o/r/pull/12';
    expect(
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'gh',
        title: 'gh pr create',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: `Created ${pr}\n` } }],
      }),
    ).toEqual([
      { kind: 'step_started', name: 'gh pr create', tool: true },
      { kind: 'link', url: pr, title: 'o/r#12', source: 'tool_output' },
    ]);
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'gh',
        status: 'completed',
        rawOutput: { stdout: `${pr}\nhttps://github.com/o/r/pull/13` },
      }),
    ).toEqual([
      {
        kind: 'link',
        url: 'https://github.com/o/r/pull/13',
        title: 'o/r#13',
        source: 'tool_output',
      },
      { kind: 'step_finished', name: 'gh pr create' },
    ]);
    expect(mapper.map(link('https://github.com/o/r/pull/14', 'PR 14'))).toEqual([
      {
        kind: 'link',
        url: 'https://github.com/o/r/pull/14',
        title: 'o/r#14',
        source: 'resource_link',
      },
      { kind: 'text_delta', delta: '[PR 14](https://github.com/o/r/pull/14)' },
    ]);
  });

  it('leaves unfinished tool steps open when the turn is cancelled', () => {
    const mapper = createUpdateMapper();
    mapper.map({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'a' } });
    mapper.map({ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'Search', status: 'pending' });
    expect(mapper.finish(true)).toEqual([]);
    expect(mapper.finish()).toEqual([]);
  });

  it('warns once and reports the mode when the agent leaves the locked chat mode', () => {
    const mapper = createUpdateMapper('Fake');
    mapper.lockMode('read-only');
    expect(
      mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'read-only' }),
    ).toEqual([]);
    expect(mapper.unsafeModeChange()).toBeNull();
    const warning = 'Warning: Fake switched to agent mode';
    expect(mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'agent' })).toEqual([
      { kind: 'step_started', name: warning },
      { kind: 'step_finished', name: warning },
    ]);
    expect(
      mapper.map({
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'mode',
            name: 'Mode',
            category: 'mode',
            type: 'select',
            currentValue: 'agent',
            options: [{ value: 'agent', name: 'Agent' }],
          },
        ],
      }),
    ).toEqual([]);
    expect(mapper.unsafeModeChange()).toBe('agent');
  });

  it('ignores mode and config updates before a mode is locked', () => {
    const mapper = createUpdateMapper();
    expect(mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'agent' })).toEqual(
      [],
    );
    expect(mapper.map({ sessionUpdate: 'config_option_update', configOptions: [] })).toEqual([]);
    expect(mapper.unsafeModeChange()).toBeNull();
  });

  it('writes web resource links as markdown links and drops other content', () => {
    const mapper = createUpdateMapper();
    expect(mapper.map(link('https://example.com/a_(b)', 'Docs [v1]'))).toEqual([
      { kind: 'text_delta', delta: '[Docs v1](https://example.com/a_%28b%29)' },
    ]);
    expect(mapper.map(link('file:///etc/passwd', 'passwd'))).toEqual([]);
    expect(mapper.map(link('not a url', 'x'))).toEqual([]);
    expect(
      mapper.map({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'AA==', mimeType: 'image/png' },
      }),
    ).toEqual([]);
    expect(mapper.repliedWithText()).toBe(true);
  });

  it('counts declined permissions as work but not plain notes', () => {
    const mapper = createUpdateMapper();
    expect(mapper.note('Using the default model')).toHaveLength(2);
    expect(mapper.didWork()).toBe(false);
    expect(mapper.clientAction('Declined: Write a.txt')).toEqual([
      { kind: 'step_started', name: 'Declined: Write a.txt', tool: true },
      { kind: 'step_finished', name: 'Declined: Write a.txt' },
    ]);
    expect(mapper.didWork()).toBe(true);
  });
});
