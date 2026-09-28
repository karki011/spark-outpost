import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserMcpList } from '@spark-outpost/contracts';
import { mcpApi, userMcpKey } from '../../api/mcp.ts';

export function useUserMcp() {
  return useQuery({ queryKey: userMcpKey, queryFn: mcpApi.list });
}

export function useMcpChange<T>(run: (input: T) => Promise<UserMcpList>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (list) => {
      queryClient.setQueryData(userMcpKey, (current: UserMcpList | undefined) => ({
        ...list,
        scan: list.scan ?? current?.scan ?? null,
      }));
      void queryClient.invalidateQueries({ queryKey: ['mcp', 'chat'] });
    },
  });
}
