import { z } from 'zod';
import {
  attachmentSchema,
  folderListingSchema,
  projectGitSchema,
  projectFilesResponseSchema,
  projectSchema,
  removedProjectSchema,
  type Attachment,
  type BuildStyle,
  type FolderListing,
  type Project,
  type ProjectFilesResponse,
  type ProjectGit,
  type RemovedProject,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const projectKeys = {
  all: ['projects'] as const,
  folders: (path: string | null) => ['folders', path] as const,
  files: (projectId: string, query: string) => ['project-files', projectId, query] as const,
  rename: (projectId: string, name: string): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  remove: (projectId: string): Promise<RemovedProject> =>
    request(removedProjectSchema, `/projects/${projectId}`, { method: 'DELETE' }),
  restore: (removed: RemovedProject): Promise<Project> =>
    request(projectSchema, '/projects/restore', {
      method: 'POST',
      body: JSON.stringify(removed),
    }),
  git: (projectId: string) => ['project-git', projectId] as const,
};

function withQuery(path: string, params: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const projectsApi = {
  list: (): Promise<Project[]> => request(z.array(projectSchema), '/projects'),
  setBuildStyle: (projectId: string, buildStyle: BuildStyle): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ buildStyle }),
    }),
  create: (rootPath: string): Promise<Project> =>
    request(projectSchema, '/projects', { method: 'POST', body: JSON.stringify({ rootPath }) }),
  rename: (projectId: string, name: string): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  remove: (projectId: string): Promise<RemovedProject> =>
    request(removedProjectSchema, `/projects/${projectId}`, { method: 'DELETE' }),
  restore: (removed: RemovedProject): Promise<Project> =>
    request(projectSchema, '/projects/restore', {
      method: 'POST',
      body: JSON.stringify(removed),
    }),
  order: (projectIds: string[]): Promise<null> =>
    request(z.null(), '/projects/order', { method: 'PUT', body: JSON.stringify({ projectIds }) }),
  orderChats: (projectId: string, conversationIds: string[]): Promise<null> =>
    request(z.null(), `/projects/${projectId}/chat-order`, {
      method: 'PUT',
      body: JSON.stringify({ conversationIds }),
    }),
  git: (projectId: string): Promise<ProjectGit> =>
    request(projectGitSchema, `/projects/${projectId}/git`),
  folders: (path: string | null): Promise<FolderListing> =>
    request(folderListingSchema, withQuery('/folders', { path })),
  files: (
    projectId: string,
    query: string,
    signal: AbortSignal | null = null,
  ): Promise<ProjectFilesResponse> =>
    request(projectFilesResponseSchema, withQuery(`/projects/${projectId}/files`, { query }), {
      signal,
    }),
  attach: (
    projectId: string,
    path: string,
    signal: AbortSignal | null = null,
  ): Promise<Attachment> =>
    request(attachmentSchema, `/projects/${projectId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ path }),
      signal,
    }),
};
