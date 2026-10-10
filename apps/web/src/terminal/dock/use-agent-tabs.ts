import { useEffect } from 'react';
import { useChatAgentTerminals } from '../../chat/commands/use-agent-terminals.ts';
import { runningTerminalIds } from './agent-tabs.ts';
import { restoreAgentTabs } from './shell-store.ts';

export function useRestoredAgentTabs(chatId: string | null): void {
  const running = runningTerminalIds(useChatAgentTerminals(chatId).data).join(' ');
  useEffect(() => {
    if (chatId && running) restoreAgentTabs(chatId, running.split(' '));
  }, [chatId, running]);
}
