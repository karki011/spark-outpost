import {
  cloneJobSchema,
  cloneJobsSchema,
  cloneOptionsSchema,
  type CloneJob,
  type CloneJobs,
  type CloneOptions,
  type StartCloneRequest,
} from '@spark-outpost/contracts';
import { request } from '../../../api/client.ts';

export const cloneKeys = {
  options: ['project-clone-options'] as const,
  jobs: ['project-clone-jobs'] as const,
};

export const cloneApi = {
  options: (): Promise<CloneOptions> => request(cloneOptionsSchema, '/project-clones/options'),
  jobs: (): Promise<CloneJobs> => request(cloneJobsSchema, '/project-clones'),
  start: (body: StartCloneRequest): Promise<CloneJob> =>
    request(cloneJobSchema, '/project-clones', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string): Promise<CloneJob> =>
    request(cloneJobSchema, `/project-clones/${id}/cancel`, { method: 'POST', body: '{}' }),
  dismiss: (id: string): Promise<CloneJobs> =>
    request(cloneJobsSchema, `/project-clones/${id}`, { method: 'DELETE', body: '{}' }),
};
