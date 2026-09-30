import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RepoAgentConfig,
  UpdateAgentConfigRequest,
  UpdateMcpServerRequest,
  UpdateRedirectsRequest,
  UpdateTrustRequest,
} from '@spark-outpost/contracts';
import { agentConfigApi, agentConfigKey, projectTrustKey } from '../../api/agent-config.ts';

const CONFIG_STALE_MS = 15_000;

export function useAgentConfig(projectId: string | null) {
  return useQuery({
    queryKey: agentConfigKey(projectId ?? ''),
    queryFn: () => agentConfigApi.get(projectId!),
    staleTime: CONFIG_STALE_MS,
    enabled: projectId !== null,
  });
}

export type AgentConfigChange =
  | { type: 'settings'; change: UpdateAgentConfigRequest }
  | { type: 'mcp'; name: string; change: UpdateMcpServerRequest }
  | { type: 'trust'; change: UpdateTrustRequest }
  | { type: 'redirects'; change: UpdateRedirectsRequest };

function send(projectId: string, request: AgentConfigChange): Promise<RepoAgentConfig> {
  switch (request.type) {
    case 'settings':
      return agentConfigApi.update(projectId, request.change);
    case 'mcp':
      return agentConfigApi.setMcp(projectId, request.name, request.change);
    case 'trust':
      return agentConfigApi.setTrust(projectId, request.change);
    case 'redirects':
      return agentConfigApi.setRedirects(projectId, request.change);
  }
}

export function useAgentConfigChange(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AgentConfigChange) => send(projectId, request),
    onSuccess: (config, request) => {
      queryClient.setQueryData(agentConfigKey(projectId), config);
      if (request.type === 'trust' || request.type === 'redirects') {
        void queryClient.invalidateQueries({ queryKey: projectTrustKey });
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: agentConfigKey(projectId) }),
  });
}
