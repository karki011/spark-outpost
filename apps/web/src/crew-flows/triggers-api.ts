import { z } from 'zod';
import {
  workflowTriggersViewSchema,
  type WorkflowTriggers,
  type WorkflowTriggersView,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const triggerKeys = {
  one: (id: string) => ['crew-workflow-triggers', id] as const,
};

export const triggersApi = {
  get: (id: string): Promise<WorkflowTriggersView> =>
    request(workflowTriggersViewSchema, `/workflows/${id}/triggers`),
  save: (id: string, triggers: WorkflowTriggers): Promise<WorkflowTriggersView> =>
    request(workflowTriggersViewSchema, `/workflows/${id}/triggers`, {
      method: 'PUT',
      body: JSON.stringify(triggers),
    }),
  release: async (holdId: string): Promise<void> => {
    await request(z.null(), `/workflow-holds/${holdId}/release`, { method: 'POST' });
  },
};
