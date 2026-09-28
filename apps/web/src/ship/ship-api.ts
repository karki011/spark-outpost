import {
  githubConnectionSchema,
  shipPreviewSchema,
  shipResultSchema,
  type GitHubConnectionStatus,
  type SaveGitHubTokenRequest,
  type ShipPreview,
  type ShipRequest,
  type ShipResult,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const shipKeys = {
  preview: (taskId: string) => ['tasks', taskId, 'ship'] as const,
  github: ['github-connection'] as const,
};

export const shipApi = {
  preview: (taskId: string): Promise<ShipPreview> =>
    request(shipPreviewSchema, `/tasks/${taskId}/ship`),
  ship: (taskId: string, body: ShipRequest): Promise<ShipResult> =>
    request(shipResultSchema, `/tasks/${taskId}/ship`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const githubApi = {
  connection: (): Promise<GitHubConnectionStatus> =>
    request(githubConnectionSchema, '/github/connection'),
  saveToken: (body: SaveGitHubTokenRequest): Promise<GitHubConnectionStatus> =>
    request(githubConnectionSchema, '/github/token', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  removeToken: (): Promise<GitHubConnectionStatus> =>
    request(githubConnectionSchema, '/github/token', { method: 'DELETE', body: '{}' }),
};
