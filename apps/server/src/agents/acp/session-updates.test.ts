import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { THINKING_STEP, createUpdateMapper, describeTool, toolTarget } from './session-updates.ts';

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
      expect.objectContaining({ kind: 'step_finished', name: THINKING_STEP }),
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
      expect.objectContaining({ kind: 'step_finished', name: 'Preparing file…' }),
      { kind: 'step_started', name: 'Failed: Preparing file…' },
      expect.objectContaining({ kind: 'step_finished', name: 'Failed: Preparing file…' }),
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
      expect.objectContaining({ kind: 'step_finished', name: 'Warning: Stream lost' }),
    ]);
    expect(mapper.failure()).toBeNull();
    expect(mapper.map(notice('error'))).toEqual([]);
    expect(mapper.failure()).toEqual({ category: 'transport_lost', title: 'Stream lost' });
    expect(mapper.map({ sessionUpdate: 'session_info_update', title: 'Chat' })).toEqual([]);
  });

  it('takes an error failure from the prompt response meta', () => {
    const mapper = createUpdateMapper();
    const failure = (severity: string) => ({
      jetbrains: {
        air: {
          version: 1,
          sessionFailure: {
            severity,
            category: 'limit',
            title: 'exceeded retry limit, last status: 429 Too Many Requests',
          },
        },
      },
    });
    mapper.stopped({ quota: { token_count: 1 } });
    mapper.stopped(failure('warning'));
    expect(mapper.failure()).toBeNull();
    mapper.stopped(failure('error'));
    expect(mapper.failure()).toEqual({
      category: 'limit',
      title: 'exceeded retry limit, last status: 429 Too Many Requests',
    });
  });

  it('counts a provider warning with no progress after it as a stall', () => {
    const warning = (category: string) => ({
      sessionUpdate: 'session_info_update' as const,
      _meta: {
        jetbrains: {
          air: { sessionFailure: { severity: 'warning', title: 'Retrying', category } },
        },
      },
    });
    const stalled = createUpdateMapper();
    stalled.map(text('Looking at the files'));
    stalled.map(warning('limit'));
    expect(stalled.stalled()).toEqual({ category: 'limit', title: 'Retrying' });
    const recovered = createUpdateMapper();
    recovered.map(warning('connection'));
    recovered.map(text('Back again'));
    expect(recovered.stalled()).toBeNull();
    const advisory = createUpdateMapper();
    advisory.map(warning('unknown'));
    expect(advisory.stalled()).toBeNull();
  });

  it('shows notices as steps and never fails the turn on an advisory error notice', () => {
    const mapper = createUpdateMapper();
    const notice = (severity: string, title: string) =>
      mapper.map({ sessionUpdate: 'notice', severity, title });
    expect(notice('warning', 'Using HTTPS transport')).toEqual([
      { kind: 'step_started', name: 'Warning: Using HTTPS transport' },
      expect.objectContaining({ kind: 'step_finished', name: 'Warning: Using HTTPS transport' }),
    ]);
    expect(notice('error', 'Boom')).toEqual([
      { kind: 'step_started', name: 'Error: Boom' },
      expect.objectContaining({ kind: 'step_finished', name: 'Error: Boom' }),
    ]);
    expect(notice('_vendor', 'Custom')).toEqual([
      { kind: 'step_started', name: 'Note: Custom' },
      expect.objectContaining({ kind: 'step_finished', name: 'Note: Custom' }),
    ]);
    expect(mapper.failure()).toBeNull();
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
      mapper.map({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'compact', description: 'Summarize', input: null }],
      }),
    ).toEqual([
      { kind: 'commands', commands: [{ name: 'compact', description: 'Summarize', hint: null }] },
    ]);
    expect(mapper.finish()).toEqual([
      expect.objectContaining({ kind: 'step_finished', name: 'Search' }),
    ]);
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
      expect.objectContaining({ kind: 'step_finished', name: THINKING_STEP }),
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

  it('leaves unfinished tool steps open when the turn is cancelled', () => {
    const mapper = createUpdateMapper();
    mapper.map({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'a' } });
    mapper.map({ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'Search', status: 'pending' });
    expect(mapper.finish(true)).toEqual([]);
    expect(mapper.finish()).toEqual([]);
  });

  const modeOption = (value: string) => ({
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select' as const,
    currentValue: value,
    options: [
      { value: 'read-only', name: 'Read-only' },
      { value: 'agent', name: 'Agent' },
    ],
  });
  const tracked = { model: 'm', effort: 'high', mode: 'read-only', values: {} };
  const names = (mode: string) => (mode === 'agent' ? 'Agent' : mode);

  it('warns once and reports the mode when the agent leaves a mode it may not leave', () => {
    const mapper = createUpdateMapper('Fake');
    mapper.trackSettings(tracked, { allowed: (mode) => mode === 'read-only', name: names });
    expect(
      mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'read-only' }),
    ).toEqual([]);
    expect(mapper.unsafeModeChange()).toBeNull();
    const warning = 'Warning: Fake switched to Agent mode';
    expect(mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'agent' })).toEqual([
      { kind: 'step_started', name: warning },
      expect.objectContaining({ kind: 'step_finished', name: warning }),
    ]);
    expect(
      mapper.map({ sessionUpdate: 'config_option_update', configOptions: [modeOption('agent')] }),
    ).toEqual([]);
    expect(mapper.unsafeModeChange()).toBe('agent');
    expect(mapper.currentMode()).toBe('read-only');
  });

  it('shows a mode change the agent is allowed to make, and follows it', () => {
    const mapper = createUpdateMapper('Fake');
    mapper.trackSettings(
      { ...tracked, mode: 'default' },
      { allowed: () => true, name: (mode) => (mode === 'plan' ? 'Plan' : mode) },
    );
    const note = 'Fake switched to Plan mode';
    expect(mapper.map({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toEqual([
      { kind: 'step_started', name: note },
      expect.objectContaining({ kind: 'step_finished', name: note }),
      {
        kind: 'session_settings',
        model: 'm',
        effort: 'high',
        mode: 'plan',
        options: {},
      },
    ]);
    expect(mapper.currentMode()).toBe('plan');
    expect(mapper.unsafeModeChange()).toBeNull();
  });

  it('reports model, effort and other option changes from config updates', () => {
    const mapper = createUpdateMapper('Fake');
    mapper.trackSettings(tracked, { allowed: () => true, name: names });
    const outputs = mapper.map({
      sessionUpdate: 'config_option_update',
      configOptions: [
        modeOption('read-only'),
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'fallback',
          options: [{ value: 'fallback', name: 'Fallback' }],
        },
        {
          id: 'fast',
          name: 'Fast mode',
          category: 'model_config',
          type: 'boolean',
          currentValue: true,
        },
      ],
    });
    expect(outputs).toEqual([
      {
        kind: 'session_settings',
        model: 'fallback',
        effort: 'high',
        mode: 'read-only',
        options: { fast: true },
      },
    ]);
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
      expect.objectContaining({ kind: 'step_finished', name: 'Declined: Write a.txt' }),
    ]);
    expect(mapper.didWork()).toBe(true);
  });

  it('describes a tool call target from its locations and input', () => {
    expect(toolTarget([{ path: '/repo/src/a.ts', line: 4 }], { file_path: '/repo/src/a.ts' })).toBe(
      '/repo/src/a.ts:4 {"file_path":"/repo/src/a.ts"}',
    );
    expect(toolTarget(undefined, { command: 'ls' })).toBe('{"command":"ls"}');
    expect(toolTarget([], undefined)).toBeNull();
    expect(toolTarget(null, { text: 'x'.repeat(1_000) })).toHaveLength(400);
  });

  it('finishes a tool step with the input the agent sent after announcing it', () => {
    const mapper = createUpdateMapper('Claude');
    const announce = (id: string) =>
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'Terminal',
        kind: 'execute',
        status: 'pending',
        rawInput: {},
      });
    const finish = (id: string, command: string) =>
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: id,
        title: `\`${command}\``,
        rawInput: { command },
        status: 'completed',
      });
    expect(announce('a')).toContainEqual({
      kind: 'step_started',
      name: 'Terminal',
      tool: true,
      toolKind: 'execute',
    });
    expect(finish('a', 'ls')).toContainEqual({
      kind: 'step_finished',
      name: 'Terminal',
      tool: true,
      toolKind: 'execute',
      target: '{"command":"ls"}',
    });
  });

  it('remembers the plan an ExitPlanMode call or a plan file showed (D-noJev)', () => {
    const mapper = createUpdateMapper();
    expect(mapper.shownPlan()).toBeNull();
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'f',
      title: 'Write',
      kind: 'edit',
      rawInput: { file_path: '/h/.claude/plans/a.md', content: '1. From the file' },
    });
    expect(mapper.shownPlan()).toBe('1. From the file');
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'p',
      title: 'Approve Plan',
      kind: 'switch_mode',
    });
    mapper.map({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'p',
      rawInput: { plan: '1. From the call' },
    });
    expect(mapper.shownPlan()).toBe('1. From the call');
  });
});
