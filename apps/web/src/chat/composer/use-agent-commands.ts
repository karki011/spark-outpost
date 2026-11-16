import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client.ts';

export function useAgentCommands(
  conversationId: string,
  hasRuns: boolean,
  runningId: string | null,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agentCommands(conversationId) });
  }, [queryClient, conversationId, runningId]);
  return useQuery({
    queryKey: queryKeys.agentCommands(conversationId),
    queryFn: () => api.getAgentCommands(conversationId),
    enabled: hasRuns,
  });
}
