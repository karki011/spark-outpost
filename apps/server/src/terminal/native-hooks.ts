import { basename, dirname, isAbsolute, join } from 'node:path';
import type { TrackedTerminalProvider } from '@spark-outpost/contracts';
import { isRecord } from '../agent-config/records.ts';

export type NativeProvider = TrackedTerminalProvider;
export type NativeHookKind =
  | 'session_start'
  | 'prompt'
  | 'tool_start'
  | 'tool_end'
  | 'permission'
  | 'question'
  | 'stop'
  | 'error'
  | 'session_end'
  | 'interrupt';

export interface NativeToolEvent {
  id: string;
  name: string;
  phase: 'start' | 'end';
  failed: boolean;
  agentId?: string;
}

export interface NativeHookEvent {
  kind: NativeHookKind;
  tool?: NativeToolEvent;
  nativeSessionId?: string;
  nativeTurnId?: string;
  permissionMode?: string;
  prompt?: string;
  reason?: string;
  transcriptPath?: string;
  agentTranscriptPath?: string;
  model?: string;
}

const NATIVE_SESSION_ID = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,99}$/;
const END_REASON = /^[a-z_]{1,40}$/;

export function isNativeSessionId(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_SESSION_ID.test(value);
}

const COMMON_EVENTS: Record<string, NativeHookKind> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool_start',
  PostToolUse: 'tool_end',
  PermissionRequest: 'permission',
  Stop: 'stop',
  SessionEnd: 'session_end',
};

function rolloutOf(path: string, threadId: string): boolean {
  const name = basename(path);
  return name.startsWith('rollout-') && name.endsWith(`-${threadId}.jsonl`);
}

function transcriptPaths(provider: NativeProvider, payload: Record<string, unknown>) {
  const { transcript_path: path, session_id: sessionId, agent_id: agentId } = payload;
  if (typeof path !== 'string' || typeof sessionId !== 'string' || !isAbsolute(path)) return {};
  if (path !== join(dirname(path), basename(path))) return {};
  const agent = isNativeSessionId(agentId) ? agentId : null;
  if (provider === 'codex') {
    if (rolloutOf(path, sessionId)) return { transcriptPath: path };
    return agent && rolloutOf(path, agent) ? { agentTranscriptPath: path } : {};
  }
  if (basename(path) !== `${sessionId}.jsonl`) return {};
  const side = join(dirname(path), sessionId, 'subagents', `agent-${agent}.jsonl`);
  return { transcriptPath: path, ...(agent ? { agentTranscriptPath: side } : {}) };
}

export function nativeHookNames(provider: NativeProvider): string[] {
  return [
    ...Object.keys(COMMON_EVENTS),
    ...(provider === 'claude'
      ? ['Notification', 'StopFailure', 'PostToolUseFailure', 'Elicitation', 'ElicitationResult']
      : ['Interrupt']),
  ];
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

export function parseNativeHook(
  provider: NativeProvider,
  payload: unknown,
): NativeHookEvent | null {
  if (!isRecord(payload) || typeof payload.hook_event_name !== 'string') return null;
  if (!nativeHookNames(provider).includes(payload.hook_event_name)) return null;
  if (
    (payload.session_id !== undefined && !isNativeSessionId(payload.session_id)) ||
    !optionalString(payload.turn_id, 200) ||
    !optionalString(payload.prompt_id, 200) ||
    !optionalString(payload.permission_mode, 100) ||
    !optionalString(payload.tool_name, 200) ||
    !optionalString(payload.tool_use_id, 200) ||
    !optionalString(payload.agent_id, 200) ||
    !optionalString(payload.model, 200) ||
    !optionalString(payload.notification_type, 100) ||
    !optionalString(payload.reason, 100) ||
    !optionalString(payload.transcript_path, 4096) ||
    !optionalString(payload.prompt, 100_000)
  ) {
    return null;
  }
  const kind = hookKind(payload);
  if (!kind) return null;
  const nativeTurnId =
    provider === 'claude' ? (payload.prompt_id ?? payload.turn_id) : payload.turn_id;
  const tool = toolEvent(payload);
  return {
    kind,
    ...(tool ? { tool } : {}),
    ...(typeof payload.session_id === 'string' ? { nativeSessionId: payload.session_id } : {}),
    ...(typeof nativeTurnId === 'string' ? { nativeTurnId } : {}),
    ...(typeof payload.permission_mode === 'string'
      ? { permissionMode: payload.permission_mode }
      : {}),
    ...(kind === 'prompt' && typeof payload.prompt === 'string' ? { prompt: payload.prompt } : {}),
    ...(kind === 'session_end' &&
    typeof payload.reason === 'string' &&
    END_REASON.test(payload.reason)
      ? { reason: payload.reason }
      : {}),
    ...transcriptPaths(provider, payload),
    ...(typeof payload.model === 'string' && payload.model ? { model: payload.model } : {}),
  };
}

const TOOL_PHASES: Record<string, Pick<NativeToolEvent, 'phase' | 'failed'>> = {
  PreToolUse: { phase: 'start', failed: false },
  PostToolUse: { phase: 'end', failed: false },
  PostToolUseFailure: { phase: 'end', failed: true },
};

function toolEvent(payload: Record<string, unknown>): NativeToolEvent | null {
  const phase = TOOL_PHASES[payload.hook_event_name as string];
  const { tool_use_id: id, tool_name: name, agent_id: agentId } = payload;
  if (!phase || typeof id !== 'string' || typeof name !== 'string') return null;
  if (!id.trim() || !name.trim()) return null;
  return { id, name, ...phase, ...(typeof agentId === 'string' && agentId ? { agentId } : {}) };
}

function hookKind(payload: Record<string, unknown>): NativeHookKind | null {
  const name = payload.hook_event_name as string;
  if (name === 'Notification') {
    if (payload.notification_type === 'permission_prompt') return 'permission';
    if (
      ['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(
        String(payload.notification_type),
      )
    )
      return 'question';
    if (payload.notification_type === 'idle_prompt') return 'stop';
    return null;
  }
  if (
    name === 'PreToolUse' &&
    ['AskUserQuestion', 'request_user_input', 'ExitPlanMode'].includes(String(payload.tool_name))
  ) {
    return 'question';
  }
  if (name === 'StopFailure') return 'error';
  if (name === 'PostToolUseFailure') return 'tool_end';
  if (name === 'Interrupt') return 'interrupt';
  if (name === 'Elicitation') return 'question';
  if (name === 'ElicitationResult') return 'tool_start';
  return COMMON_EVENTS[name] ?? null;
}
