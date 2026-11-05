import { z } from 'zod';
import {
  projectTrustSchema,
  repoAgentConfigSchema,
  type ProjectTrust,
  type RepoAgentConfig,
  type UpdateAgentConfigRequest,
  type UpdateMcpServerRequest,
  type UpdateRedirectsRequest,
  type UpdateTrustRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const agentConfigKey = (projectId: string) => ['agent-config', projectId] as const;
export const projectTrustKey = ['agent-config-trust'] as const;

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
  setTrust: (projectId: string, change: UpdateTrustRequest): Promise<RepoAgentConfig> =>
    request(repoAgentConfigSchema, `/projects/${projectId}/agent-config/trust`, {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  setRedirects: (projectId: string, change: UpdateRedirectsRequest): Promise<RepoAgentConfig> =>
    request(repoAgentConfigSchema, `/projects/${projectId}/agent-config/trust/redirects`, {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  trustList: (): Promise<ProjectTrust[]> =>
    request(z.array(projectTrustSchema), '/agent-config/trust'),
};
