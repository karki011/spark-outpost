import type { AgentModeOption, NativeTerminalProvider } from '@spark-outpost/contracts';

export const TERMINAL_AGENTS: readonly { id: NativeTerminalProvider; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
];

export const CODEX_ASK_MODE = 'ask-every-action';

export const CODEX_ASK_UNAVAILABLE =
  'Ask every time is unavailable in this Codex terminal. Choose Read-only, Approve for me, or Full access, or use Chat.';

export function terminalAgentName(provider: NativeTerminalProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code';
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
