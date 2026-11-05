import { useQuery } from '@tanstack/react-query';
import {
  isTrackedTerminalProvider,
  terminalProviderName,
  trackedTerminalProviderSchema,
  type AgentModeOption,
  type NativeTerminalProvider,
} from '@spark-outpost/contracts';
import { nativeTerminalApi } from './terminal-api.ts';

export const TERMINAL_AGENTS = trackedTerminalProviderSchema.options.map((id) => ({
  id,
  name: terminalProviderName(id),
}));

export const CODEX_ASK_MODE = 'ask-every-action';

export const CODEX_ASK_UNAVAILABLE =
  'Ask every time is unavailable in this Codex terminal. Choose Read-only, Approve for me, or Full access, or use Chat.';

export const UNTRACKED_NOTE =
  'Spark starts it in this session’s folder and records only whether it is running: no steps, usage, approvals or phone messages.';

const TERMINAL_AGENTS_STALE_MS = 60_000;

export function useOtherTerminalAgents() {
  return useQuery({
    queryKey: ['terminal-agents'],
    queryFn: nativeTerminalApi.agents,
    staleTime: TERMINAL_AGENTS_STALE_MS,
    select: (agents) => agents.filter((agent) => !isTrackedTerminalProvider(agent.id)),
  });
}

export function terminalModeBlocked(provider: NativeTerminalProvider, mode: string | null) {
  return provider === 'codex' && mode === CODEX_ASK_MODE;
}

export function terminalModes(
  provider: NativeTerminalProvider,
  modes: readonly AgentModeOption[],
): AgentModeOption[] {
  return modes.filter((mode) => !terminalModeBlocked(provider, mode.id));
}
