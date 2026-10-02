import {
  steerResponseSchema,
  taskDetailSchema,
  taskLinkSchema,
  type AddTaskLinkRequest,
  type SteerRequest,
  type SteerResponse,
  type TaskDetail,
  type TaskLink,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const taskKeys = {
  all: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  changes: (id: string) => ['tasks', id, 'changes'] as const,
};

export const taskApi = {
  get: (id: string): Promise<TaskDetail> => request(taskDetailSchema, `/tasks/${id}`),
  addLink: (id: string, link: AddTaskLinkRequest): Promise<TaskLink> =>
    request(taskLinkSchema, `/tasks/${id}/links`, { method: 'POST', body: JSON.stringify(link) }),
  markdownUrl: (id: string, kind: 'plan') => `/api/tasks/${id}/artifacts/${kind}.md`,
  steer: (id: string, steer: SteerRequest): Promise<SteerResponse> =>
    request(steerResponseSchema, `/tasks/${id}/steer`, {
      method: 'POST',
      body: JSON.stringify(steer),
    }),
};
