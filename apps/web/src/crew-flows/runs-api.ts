import { z } from 'zod';
import { workflowRunSchema, type WorkflowRun } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const runListSchema = z.object({ runs: z.array(workflowRunSchema) });

export const workflowRunKeys = {
  all: ['crew-workflow-runs'] as const,
  list: (workflowId: string) => ['crew-workflow-runs', 'list', workflowId] as const,
  one: (runId: string) => ['crew-workflow-runs', 'one', runId] as const,
};

export const workflowRunsApi = {
  list: async (workflowId: string): Promise<WorkflowRun[]> =>
    (await request(runListSchema, `/workflows/${workflowId}/runs`)).runs,
  get: (runId: string): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/workflow-runs/${runId}`),
  stop: (runId: string): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/workflow-runs/${runId}/stop`, { method: 'POST' }),
};
