import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserMcpList } from '@spark-outpost/contracts';
import { chatMcpRoot, mcpApi, userMcpKey } from '../../api/mcp.ts';

export function useUserMcp() {
  return useQuery({ queryKey: userMcpKey, queryFn: mcpApi.list });
}

export function useMcpChange<T>(run: (input: T) => Promise<UserMcpList>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (list) => {
      queryClient.setQueryData(userMcpKey, list);
      void queryClient.invalidateQueries({ queryKey: chatMcpRoot });
    },
  });
}
