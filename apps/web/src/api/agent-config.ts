import {
  repoAgentConfigSchema,
  type RepoAgentConfig,
  type UpdateAgentConfigRequest,
  type UpdateMcpServerRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const agentConfigKey = (projectId: string) => ['agent-config', projectId] as const;

export const agentConfigApi = {
  get: (projectId: string): Promise<RepoAgentConfig> =>
    request(repoAgentConfigSchema, `/projects/${projectId}/agent-config`),
  update: (projectId: string, change: UpdateAgentConfigRequest): Promise<RepoAgentConfig> =>
    request(repoAgentConfigSchema, `/projects/${projectId}/agent-config`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),
  setMcp: (
    projectId: string,
    name: string,
    change: UpdateMcpServerRequest,
  ): Promise<RepoAgentConfig> =>
    request(
      repoAgentConfigSchema,
      `/projects/${projectId}/agent-config/mcp/${encodeURIComponent(name)}`,
      { method: 'PUT', body: JSON.stringify(change) },
    ),
};
