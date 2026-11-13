import { z } from 'zod';
import {
  workflowRunSchema,
  workflowTestRunSchema,
  type StartSparkTestRun,
  type WorkflowRun,
  type WorkflowTestRun,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export interface TestRunStart {
  projectId: string | null;
  message: string;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const testRunKeys = {
  one: (id: string) => ['crew-test-run', id] as const,
};

export const testRunApi = {
  startWorkflow: (workflowId: string, start: TestRunStart): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/workflows/${workflowId}/runs`, post({ kind: 'test', ...start })),
  startSpark: (sparkId: string, start: StartSparkTestRun): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/teammates/${sparkId}/test-runs`, post(start)),
  runForReal: (workflowId: string, start: TestRunStart): Promise<WorkflowRun> =>
    request(workflowRunSchema, `/workflows/${workflowId}/runs`, post({ kind: 'run', ...start })),
  get: (id: string): Promise<WorkflowTestRun> =>
    request(workflowTestRunSchema, `/workflow-runs/${id}/test`),
  discard: (id: string): Promise<null> =>
    request(z.null(), `/workflow-runs/${id}`, { method: 'DELETE', keepalive: true }),
};
