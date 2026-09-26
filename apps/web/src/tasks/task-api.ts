import {
  changedFileSchema,
  taskChangesSchema,
  taskDetailSchema,
  taskLinkSchema,
  type AddTaskLinkRequest,
  type ChangedFile,
  type TaskChanges,
  type TaskDetail,
  type TaskLink,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const taskKeys = {
  all: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  changes: (id: string) => ['tasks', id, 'changes'] as const,
  changedFile: (id: string, runId: string, path: string) =>
    ['tasks', id, 'changes', runId, path] as const,
};

export const taskApi = {
  get: (id: string): Promise<TaskDetail> => request(taskDetailSchema, `/tasks/${id}`),
  changes: (id: string): Promise<TaskChanges> => request(taskChangesSchema, `/tasks/${id}/changes`),
  changedFile: (id: string, runId: string, path: string): Promise<ChangedFile> =>
    request(
      changedFileSchema,
      `/tasks/${id}/changes/file?${new URLSearchParams({ runId, path }).toString()}`,
    ),
  addLink: (id: string, link: AddTaskLinkRequest): Promise<TaskLink> =>
    request(taskLinkSchema, `/tasks/${id}/links`, { method: 'POST', body: JSON.stringify(link) }),
  markdownUrl: (id: string, kind: 'plan') => `/api/tasks/${id}/artifacts/${kind}.md`,
};
