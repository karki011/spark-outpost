import { loadTerminalLive, usageOf } from '../terminal-live.ts';

export const terminalUsageKey = (conversationId: string) =>
  ['native-terminal', conversationId, 'usage'] as const;

export const terminalUsageQuery = (conversationId: string) => ({
  queryKey: terminalUsageKey(conversationId),
  queryFn: async () => usageOf(await loadTerminalLive(conversationId)),
});
