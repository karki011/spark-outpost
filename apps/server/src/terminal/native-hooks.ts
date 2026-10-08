import { isRecord } from '../agent-config/records.ts';

export type NativeProvider = 'claude' | 'codex';
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

export interface NativeHookEvent {
  kind: NativeHookKind;
  nativeSessionId?: string;
  nativeTurnId?: string;
  permissionMode?: string;
  prompt?: string;
  reason?: string;
}

const END_REASON = /^[a-z_]{1,40}$/;

const COMMON_EVENTS: Record<string, NativeHookKind> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool_start',
  PostToolUse: 'tool_end',
  PermissionRequest: 'permission',
  Stop: 'stop',
  SessionEnd: 'session_end',
};

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
    !optionalString(payload.session_id, 200) ||
    !optionalString(payload.turn_id, 200) ||
    !optionalString(payload.prompt_id, 200) ||
    !optionalString(payload.permission_mode, 100) ||
    !optionalString(payload.tool_name, 200) ||
    !optionalString(payload.notification_type, 100) ||
    !optionalString(payload.reason, 100) ||
    !optionalString(payload.prompt, 100_000)
  ) {
    return null;
  }
  const kind = hookKind(payload);
  if (!kind) return null;
  const nativeTurnId =
    provider === 'claude' ? (payload.prompt_id ?? payload.turn_id) : payload.turn_id;
  return {
    kind,
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
  };
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
