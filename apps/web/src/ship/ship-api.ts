import {
  chatPrRouteSchema,
  githubAppSignInSchema,
  githubConnectionSchema,
  githubTestResultSchema,
  shipPreviewSchema,
  shipResultSchema,
  type ChatPrRoute,
  type GitHubAppSignIn,
  type GitHubConnectionStatus,
  type GitHubTestResult,
  type SaveGitHubTokenRequest,
  type ShipPreview,
  type ShipRequest,
  type ShipResult,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const shipKeys = {
  preview: (taskId: string) => ['tasks', taskId, 'ship'] as const,
  github: ['github-connection'] as const,
  githubSignIn: ['github-sign-in'] as const,
  prRoutes: ['pr-route'] as const,
  prRoute: (conversationId: string) => ['pr-route', conversationId] as const,
};

export const shipApi = {
  preview: (taskId: string): Promise<ShipPreview> =>
    request(shipPreviewSchema, `/tasks/${taskId}/ship`),
  ship: (taskId: string, body: ShipRequest): Promise<ShipResult> =>
    request(shipResultSchema, `/tasks/${taskId}/ship`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  prRoute: (conversationId: string): Promise<ChatPrRoute> =>
    request(chatPrRouteSchema, `/conversations/${conversationId}/pr-route`),
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
  signIn: (): Promise<GitHubAppSignIn> => request(githubAppSignInSchema, '/github/app/sign-in'),
  startSignIn: (): Promise<GitHubAppSignIn> =>
    request(githubAppSignInSchema, '/github/app/sign-in', { method: 'POST', body: '{}' }),
  cancelSignIn: (): Promise<GitHubAppSignIn> =>
    request(githubAppSignInSchema, '/github/app/sign-in', { method: 'DELETE', body: '{}' }),
  recheckApp: (): Promise<GitHubConnectionStatus> =>
    request(githubConnectionSchema, '/github/app/repos', { method: 'POST', body: '{}' }),
  disconnectApp: (): Promise<GitHubConnectionStatus> =>
    request(githubConnectionSchema, '/github/app', { method: 'DELETE', body: '{}' }),
  test: (): Promise<GitHubTestResult> =>
    request(githubTestResultSchema, '/github/test', { method: 'POST', body: '{}' }),
};
