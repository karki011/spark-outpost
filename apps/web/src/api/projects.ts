import { z } from 'zod';
import {
  attachmentSchema,
  createdFolderSchema,
  folderListingSchema,
  instructionsFileSchema,
  projectGitSchema,
  projectFileContentSchema,
  projectFilesResponseSchema,
  projectSchema,
  removedProjectSchema,
  reposFoldersSchema,
  type Attachment,
  type CreatedFolder,
  type FolderListing,
  type InstructionsFile,
  type Project,
  type ProjectFileContent,
  type ProjectFilesResponse,
  type ProjectGit,
  type RemovedProject,
  type ReposFolders,
  type UpdateProjectRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export type ProjectSettings = Pick<UpdateProjectRequest, 'workPlace'>;

export interface FolderPick {
  files: 'instructions' | null;
  hidden: boolean;
}

const FOLDERS_ONLY: FolderPick = { files: null, hidden: false };

export const projectKeys = {
  all: ['projects'] as const,
  reposFolders: ['repos-folders'] as const,
  folders: (path: string | null, pick: FolderPick = FOLDERS_ONLY) =>
    ['folders', path, pick.files, pick.hidden] as const,
  instructionsFile: (path: string) => ['instructions-file', path] as const,
  files: (projectId: string, query: string) => ['project-files', projectId, query] as const,
  file: (projectId: string, path: string) => ['project-file', projectId, path] as const,
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
  reposFolders: (): Promise<ReposFolders> => request(reposFoldersSchema, '/repos-folders'),
  saveReposFolders: (folders: string[]): Promise<ReposFolders> =>
    request(reposFoldersSchema, '/repos-folders', {
      method: 'PUT',
      body: JSON.stringify({ folders }),
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
  updateSettings: (projectId: string, change: ProjectSettings): Promise<Project> =>
    request(projectSchema, `/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
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
  gitInit: (projectId: string): Promise<ProjectGit> =>
    request(projectGitSchema, `/projects/${projectId}/git-init`, { method: 'POST' }),
  createFolder: (parent: string, name: string): Promise<CreatedFolder> =>
    request(createdFolderSchema, '/folders', {
      method: 'POST',
      body: JSON.stringify({ parent, name }),
    }),
  folders: (path: string | null, pick: FolderPick = FOLDERS_ONLY): Promise<FolderListing> =>
    request(
      folderListingSchema,
      withQuery('/folders', { path, files: pick.files, hidden: pick.hidden ? '1' : null }),
    ),
  instructionsFile: (path: string): Promise<InstructionsFile> =>
    request(instructionsFileSchema, withQuery('/instructions-file', { path })),
  files: (
    projectId: string,
    query: string,
    signal: AbortSignal | null = null,
  ): Promise<ProjectFilesResponse> =>
    request(projectFilesResponseSchema, withQuery(`/projects/${projectId}/files`, { query }), {
      signal,
    }),
  file: (projectId: string, path: string): Promise<ProjectFileContent> =>
    request(projectFileContentSchema, withQuery(`/projects/${projectId}/file`, { path })),
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
