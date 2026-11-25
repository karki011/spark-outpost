import { setupDraftsSchema, type SetupDrafts, type SetupTarget } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const setupDraftsKey = ['setup-drafts'] as const;

export const setupDraftsApi = {
  list: (): Promise<SetupDrafts> => request(setupDraftsSchema, '/setup-drafts'),
  clear: (target: SetupTarget): Promise<SetupDrafts> =>
    request(setupDraftsSchema, `/setup-drafts/${target}`, { method: 'DELETE' }),
};
