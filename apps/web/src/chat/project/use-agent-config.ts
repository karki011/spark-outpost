import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RepoAgentConfig,
  UpdateAgentConfigRequest,
  UpdateMcpServerRequest,
} from '@spark-outpost/contracts';
import { agentConfigApi, agentConfigKey } from '../../api/agent-config.ts';

const CONFIG_STALE_MS = 15_000;

export function useAgentConfig(projectId: string | null) {
  return useQuery({
    queryKey: agentConfigKey(projectId ?? ''),
    queryFn: () => agentConfigApi.get(projectId ?? ''),
    enabled: projectId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export type AgentConfigChange =
  | { type: 'settings'; change: UpdateAgentConfigRequest }
  | { type: 'mcp'; name: string; change: UpdateMcpServerRequest };

export function useAgentConfigChange(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AgentConfigChange): Promise<RepoAgentConfig> =>
      request.type === 'settings'
        ? agentConfigApi.update(projectId, request.change)
        : agentConfigApi.setMcp(projectId, request.name, request.change),
    onSuccess: (config) => queryClient.setQueryData(agentConfigKey(projectId), config),
    onError: () => queryClient.invalidateQueries({ queryKey: agentConfigKey(projectId) }),
  });
}
