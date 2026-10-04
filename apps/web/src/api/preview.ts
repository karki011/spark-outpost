import {
  chatPreviewSchema,
  createShellResponseSchema,
  projectPreviewSchema,
  projectSchema,
  type ChatPreview,
  type CreateShellResponse,
  type PreviewConfig,
  type Project,
  type ProjectPreview,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const previewKeys = {
  all: ['preview'] as const,
  project: (projectId: string) => ['preview', 'project', projectId] as const,
  chat: (conversationId: string) => ['preview', 'chat', conversationId] as const,
};

function post(body: object = {}): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export const previewApi = {
  project: (projectId: string): Promise<ProjectPreview> =>
    request(projectPreviewSchema, `/projects/${projectId}/preview`),
  save: (projectId: string, preview: PreviewConfig | null): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}/preview`, {
      method: 'PUT',
      body: JSON.stringify({ preview }),
    }),
  chat: (conversationId: string): Promise<ChatPreview> =>
    request(chatPreviewSchema, `/conversations/${conversationId}/preview`),
  start: (conversationId: string): Promise<ChatPreview> =>
    request(chatPreviewSchema, `/conversations/${conversationId}/preview/start`, post()),
  stop: (conversationId: string): Promise<ChatPreview> =>
    request(chatPreviewSchema, `/conversations/${conversationId}/preview/stop`, post()),
  terminal: (conversationId: string): Promise<CreateShellResponse> =>
    request(createShellResponseSchema, '/terminal/previews', post({ conversationId })),
};
