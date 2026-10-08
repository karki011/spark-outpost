import type {
  ConversationSummary,
  NativeTerminalSession,
  RunStatus,
} from '@spark-outpost/contracts';
import type { SessionState } from '../island/island-model.ts';

export function terminalLabel(state: NativeTerminalSession['state']): string {
  const labels: Record<NativeTerminalSession['state'], string> = {
    starting: 'Starting',
    working: 'Running',
    waiting_for_permission: 'Waiting for permission',
    waiting_for_input: 'Waiting for input',
    ready: 'Idle',
    exited: 'Exited',
    error: 'Stopped with an error',
    unknown: 'Open',
    interrupted: 'Interrupted',
  };
  return labels[state];
}

export function terminalMood(state: NativeTerminalSession['state']): SessionState {
  if (state === 'working' || state === 'starting') return 'working';
  if (state === 'waiting_for_permission' || state === 'waiting_for_input') return 'waiting';
  if (state === 'error' || state === 'interrupted') return 'failed';
  return 'idle';
}

export function terminalNeedsInput(chat: ConversationSummary): boolean {
  return (
    chat.terminal?.state === 'waiting_for_input' ||
    chat.terminal?.state === 'waiting_for_permission'
  );
}

export function terminalEnded(session: NativeTerminalSession): boolean {
  return ['exited', 'error', 'interrupted'].includes(session.state);
}

export function terminalRelaunch(
  session: NativeTerminalSession,
  latestRunStatus: RunStatus | null,
): 'resume' | 'restart' | null {
  if (!terminalEnded(session)) return null;
  if (session.resumeAvailable) return 'resume';
  return latestRunStatus === 'cancelled' ? null : 'restart';
}
