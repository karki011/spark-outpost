import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { needsInput } from '@spark-outpost/contracts';
import { isRunning } from '../conversations/row-state.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { terminalUsageQuery } from '../terminal/usage/terminal-usage-api.ts';
import { isTerminalSession, sessionLine, waitsOnCard, type SessionLine } from './session-line.ts';

const LIVE_REFRESH_MS = 2000;

function isLiveSession(chat: ConversationSummary): boolean {
  return isRunning(chat) || needsInput(chat);
}

export function useSessionLine(chat: ConversationSummary, shown = true): SessionLine {
  const { remote } = useRemoteClient();
  const live = isLiveSession(chat);
  const usage = useQuery({
    ...terminalUsageQuery(chat.id),
    enabled: !remote && isTerminalSession(chat) && !waitsOnCard(chat) && (live || shown),
    refetchInterval: (query) => (live && query.state.status !== 'error' ? LIVE_REFRESH_MS : false),
    retry: false,
  });
  return sessionLine(chat, usage.data);
}
