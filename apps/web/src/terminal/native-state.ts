import type { NativeTerminalSession, RunStatus } from '@spark-outpost/contracts';
import type { SessionState } from '../island/island-model.ts';

export { terminalLabel, terminalNeedsInput } from '@spark-outpost/contracts';

export function terminalMood(state: NativeTerminalSession['state']): SessionState {
  if (state === 'working' || state === 'starting') return 'working';
  if (state === 'waiting_for_permission' || state === 'waiting_for_input') return 'waiting';
  if (state === 'error' || state === 'interrupted') return 'failed';
  return 'idle';
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
