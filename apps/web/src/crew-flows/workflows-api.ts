import { z } from 'zod';
import {
  workflowFileSchema,
  workflowRunSchema,
  workflowSummarySchema,
  type SaveWorkflow,
  type StartWorkflowRun,
  type WorkflowFile,
  type WorkflowRun,
  type WorkflowSummary,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const workflowListSchema = z.object({ workflows: z.array(workflowSummarySchema) });

export const workflowKeys = {
  all: ['crew-workflows'] as const,
  one: (id: string) => ['crew-workflows', id] as const,
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const workflowsApi = {
  list: async (): Promise<WorkflowSummary[]> =>
    (await request(workflowListSchema, '/crew/workflows')).workflows,
  get: (id: string): Promise<WorkflowFile> => request(workflowFileSchema, `/crew/workflows/${id}`),
  save: (input: SaveWorkflow): Promise<WorkflowFile> =>
    request(workflowFileSchema, `/crew/workflows/${input.workflow.id}`, json('PUT', input)),
  remove: (id: string): Promise<null> =>
    request(z.null(), `/crew/workflows/${id}`, { method: 'DELETE' }),
  startRun: (id: string, input: Partial<StartWorkflowRun> = {}): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/crew/workflows/${id}/runs`, json('POST', input)),
};
