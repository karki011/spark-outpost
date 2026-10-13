import { describe, expect, it } from 'vitest';
import { parseNativeHook } from './native-hooks.ts';

describe('native terminal observation', () => {
  it('records lifecycle identity without copying tool arguments or results', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'native-session',
      turn_id: 'native-turn',
      permission_mode: 'plan',
      tool_name: 'Bash',
      tool_input: { command: 'secret command' },
      tool_response: 'secret output',
    };
    const expected = {
      kind: 'tool_start',
      nativeSessionId: 'native-session',
      nativeTurnId: 'native-turn',
      permissionMode: 'plan',
    };
    expect(parseNativeHook('codex', payload)).toEqual(expected);
    expect(parseNativeHook('codex', payload)).toEqual(expected);
  });

  it('names a tool call by its id and never by its input', () => {
    const call = { tool_use_id: 'toolu_1', tool_name: 'Bash', tool_input: { command: 'secret' } };
    expect(parseNativeHook('claude', { hook_event_name: 'PreToolUse', ...call })?.tool).toEqual({
      id: 'toolu_1',
      name: 'Bash',
      phase: 'start',
      failed: false,
    });
    expect(
      parseNativeHook('claude', { hook_event_name: 'PostToolUseFailure', agent_id: 'a1', ...call })
        ?.tool,
    ).toEqual({ id: 'toolu_1', name: 'Bash', phase: 'end', failed: true, agentId: 'a1' });
    expect(parseNativeHook('codex', { hook_event_name: 'PostToolUse', ...call })?.tool).toEqual({
      id: 'toolu_1',
      name: 'Bash',
      phase: 'end',
      failed: false,
    });
    expect(
      parseNativeHook('claude', {
        hook_event_name: 'PreToolUse',
        tool_use_id: 'toolu_2',
        tool_name: 'AskUserQuestion',
      }),
    ).toMatchObject({ kind: 'question', tool: { id: 'toolu_2', phase: 'start' } });
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', ...call })).toEqual({
      kind: 'stop',
    });
    expect(parseNativeHook('claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toEqual(
      { kind: 'tool_start' },
    );
    expect(
      parseNativeHook('claude', { hook_event_name: 'PreToolUse', ...call, tool_use_id: 7 }),
    ).toBeNull();
  });

  it('recognizes immediate input requests and explicit provider idle notifications', () => {
    expect(
      parseNativeHook('claude', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }),
    ).toEqual({ kind: 'question' });
    expect(parseNativeHook('codex', { hook_event_name: 'PermissionRequest' })).toEqual({
      kind: 'permission',
    });
    expect(
      parseNativeHook('claude', {
        hook_event_name: 'Notification',
        notification_type: 'idle_prompt',
      }),
    ).toEqual({ kind: 'stop' });
    expect(parseNativeHook('claude', { hook_event_name: 'Elicitation' })).toEqual({
      kind: 'question',
    });
    expect(parseNativeHook('claude', { hook_event_name: 'ElicitationResult' })).toEqual({
      kind: 'tool_start',
    });
  });

  it('rejects unsupported and malformed events', () => {
    expect(parseNativeHook('codex', { hook_event_name: 'StopFailure' })).toBeNull();
    expect(parseNativeHook('claude', { hook_event_name: 'Interrupt' })).toBeNull();
    expect(parseNativeHook('codex', { hook_event_name: 'NewFutureEvent' })).toBeNull();
    expect(parseNativeHook('codex', { hook_event_name: 'Stop', turn_id: 3 })).toBeNull();
    expect(
      parseNativeHook('claude', {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'a'.repeat(100_001),
      }),
    ).toBeNull();
  });

  it('forwards prompt text only for actual prompt submission', () => {
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', prompt: 'old prompt' })).toEqual({
      kind: 'stop',
    });
    expect(
      parseNativeHook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'New task' }),
    ).toEqual({ kind: 'prompt', prompt: 'New task' });
  });

  it('uses Claude prompt IDs to fence late lifecycle callbacks across turns', () => {
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', prompt_id: 'prompt-1' })).toEqual({
      kind: 'stop',
      nativeTurnId: 'prompt-1',
    });
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', prompt_id: 3 })).toBeNull();
  });

  it('forwards a session end reason only when it is a plain token', () => {
    expect(parseNativeHook('claude', { hook_event_name: 'SessionEnd', reason: 'clear' })).toEqual({
      kind: 'session_end',
      reason: 'clear',
    });
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', reason: 'clear' })).toEqual({
      kind: 'stop',
    });
    expect(
      parseNativeHook('claude', { hook_event_name: 'SessionEnd', reason: 'Not a token!' }),
    ).toEqual({ kind: 'session_end' });
  });

  it('rejects session ids that are not plain tokens', () => {
    for (const session_id of ['--resume', '-x', 'a b', 'a;b', '', 'a'.repeat(101)])
      expect(parseNativeHook('claude', { hook_event_name: 'SessionStart', session_id })).toBeNull();
    expect(
      parseNativeHook('claude', {
        hook_event_name: 'SessionStart',
        session_id: '067f7c50-6ed9-48db-b1ea-683e216e3d35',
      }),
    ).toEqual({ kind: 'session_start', nativeSessionId: '067f7c50-6ed9-48db-b1ea-683e216e3d35' });
  });

  it('keeps a Claude transcript path only when it is the absolute file of the reported session', () => {
    const event = { hook_event_name: 'UserPromptSubmit', session_id: 'native-session' };
    const path = '/home/projects/repo/native-session.jsonl';
    expect(parseNativeHook('claude', { ...event, transcript_path: path })).toEqual({
      kind: 'prompt',
      nativeSessionId: 'native-session',
      transcriptPath: path,
    });
    for (const transcript_path of [
      'native-session.jsonl',
      '/home/projects/repo/another-session.jsonl',
      '/home/projects/repo/../native-session.jsonl',
      '/home/projects/repo/native-session.jsonl/',
    ])
      expect(parseNativeHook('claude', { ...event, transcript_path })).toEqual({
        kind: 'prompt',
        nativeSessionId: 'native-session',
      });
    expect(parseNativeHook('codex', { ...event, transcript_path: path })).toEqual({
      kind: 'prompt',
      nativeSessionId: 'native-session',
    });
    expect(parseNativeHook('claude', { hook_event_name: 'Stop', transcript_path: path })).toEqual({
      kind: 'stop',
    });
    expect(parseNativeHook('claude', { ...event, transcript_path: 7 })).toBeNull();
  });

  it('keeps a Codex rollout path only when it is the file of the reported thread', () => {
    const event = { hook_event_name: 'UserPromptSubmit', session_id: 'thread-1', model: 'gpt-x' };
    const path = '/home/.codex/sessions/2026/10/12/rollout-2026-10-12T21-48-18-thread-1.jsonl';
    expect(parseNativeHook('codex', { ...event, transcript_path: path })).toEqual({
      kind: 'prompt',
      nativeSessionId: 'thread-1',
      transcriptPath: path,
      model: 'gpt-x',
    });
    for (const transcript_path of [
      '/home/.codex/sessions/thread-1.jsonl',
      '/home/.codex/sessions/rollout-2026-thread-2.jsonl',
      'rollout-2026-thread-1.jsonl',
    ])
      expect(parseNativeHook('codex', { ...event, transcript_path })).toEqual({
        kind: 'prompt',
        nativeSessionId: 'thread-1',
        model: 'gpt-x',
      });
  });

  it('names the file of a sub-agent only from the ids the hook reports', () => {
    const tool = { hook_event_name: 'PreToolUse', tool_use_id: 'call_1', tool_name: 'Bash' };
    const child = '/home/.codex/sessions/2026/10/12/rollout-2026-10-12T21-49-25-thread-2.jsonl';
    expect(
      parseNativeHook('codex', {
        ...tool,
        session_id: 'thread-1',
        agent_id: 'thread-2',
        transcript_path: child,
      }),
    ).toMatchObject({ agentTranscriptPath: child, tool: { agentId: 'thread-2' } });
    expect(
      parseNativeHook('codex', {
        ...tool,
        session_id: 'thread-1',
        agent_id: 'thread-3',
        transcript_path: child,
      }),
    ).not.toHaveProperty('agentTranscriptPath');
    const main = '/home/projects/repo/native-session.jsonl';
    expect(
      parseNativeHook('claude', {
        ...tool,
        session_id: 'native-session',
        agent_id: 'aec39d782762e820d',
        transcript_path: main,
      }),
    ).toMatchObject({
      transcriptPath: main,
      agentTranscriptPath:
        '/home/projects/repo/native-session/subagents/agent-aec39d782762e820d.jsonl',
    });
    expect(
      parseNativeHook('claude', {
        ...tool,
        session_id: 'native-session',
        agent_id: '../../other',
        transcript_path: main,
      }),
    ).not.toHaveProperty('agentTranscriptPath');
  });
});
