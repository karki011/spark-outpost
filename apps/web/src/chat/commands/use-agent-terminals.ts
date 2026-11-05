import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentTerminal } from '@spark-outpost/contracts';
import { agentTerminalKeys, agentTerminalsApi } from '../../api/agent-terminals.ts';

export function useChatAgentTerminals(chatId: string | null) {
  return useQuery({
    queryKey: agentTerminalKeys.chat(chatId ?? ''),
    queryFn: () => agentTerminalsApi.list(chatId ?? ''),
    enabled: chatId !== null,
  });
}

export interface AgentTerminalStop {
  stopping: boolean;
  error: string | null;
  stop(): void;
}

export function useStopAgentTerminal(chatId: string, terminalId: string): AgentTerminalStop {
  const queryClient = useQueryClient();
  const key = agentTerminalKeys.chat(chatId);
  const stop = useMutation({
    mutationFn: () => agentTerminalsApi.stop(chatId, terminalId),
    onSuccess: (stopped) => {
      queryClient.setQueryData<AgentTerminal[]>(key, (terminals) =>
        terminals?.map((terminal) => (terminal.id === stopped.id ? stopped : terminal)),
      );
      return queryClient.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  return {
    stopping: stop.isPending,
    error: stop.error ? `Couldn’t stop it: ${stop.error.message}` : null,
    stop: () => stop.mutate(),
  };
}

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
