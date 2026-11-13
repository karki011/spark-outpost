import { expect, type Page, type Route } from '@playwright/test';
import {
  saveWorkflowSchema,
  workflowProblems,
  workflowStages,
  type Workflow,
} from '../../packages/contracts/src/crew-workflow.ts';

export const PANEL_PATH = '/crew-flows-preview.html';

interface StoredWorkflow {
  workflow: Workflow;
  hash: string;
}

export interface FakeWorkflowApi {
  files: Map<string, StoredWorkflow>;
  saves: { id: string; baseHash: string | null }[];
  runs: string[];
  put: (workflow: Workflow) => void;
}

function summary(stored: StoredWorkflow, sparks: ReadonlySet<string>) {
  const { workflow } = stored;
  const sparkOf = new Map(workflow.steps.map((step) => [step.id, step.sparkId]));
  return {
    id: workflow.id,
    name: workflow.name,
    stages: workflowStages(workflow.steps).map((stage) =>
      stage.map((stepId) => ({ stepId, sparkId: sparkOf.get(stepId)! })),
    ),
    problems: workflowProblems(workflow.steps, sparks).length,
  };
}

export async function fakeWorkflowApi(
  page: Page,
  sparkIds: readonly string[],
): Promise<FakeWorkflowApi> {
  const sparks = new Set(sparkIds);
  let version = 0;
  const api: FakeWorkflowApi = {
    files: new Map(),
    saves: [],
    runs: [],
    put: (workflow) => {
      version += 1;
      api.files.set(workflow.id, { workflow, hash: `hash-${version}` });
    },
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/workflows', async (route) => {
    await json(route, 200, {
      workflows: [...api.files.values()].map((stored) => summary(stored, sparks)),
    });
  });
  const started: unknown[] = [];
  await page.route('**/api/workflow-runs/*', async (route) => {
    await json(route, 200, started.at(-1));
  });
  await page.route('**/api/workflows/*/runs', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    if (route.request().method() === 'GET') return json(route, 200, { runs: started });
    const stored = api.files.get(id);
    if (!stored) return json(route, 404, { error: 'That workflow no longer exists.' });
    api.runs.push(id);
    const run = {
      id: '00000000-0000-4000-8000-00000000f001',
      workflowId: id,
      workflowName: stored.workflow.name,
      kind: 'run',
      source: 'manual',
      status: 'running',
      conversationId: null,
      runId: null,
      stoppedBy: null,
      steps: stored.workflow.steps.map((entry) => ({
        stepId: entry.id,
        sparkId: entry.sparkId,
        dependsOn: entry.dependsOn,
        state: 'waiting',
        runId: null,
        note: null,
        startedAt: null,
        finishedAt: null,
      })),
      spend: { tokens: 0, costUsd: null, costSource: null },
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    started.unshift(run);
    return json(route, 201, run);
  });
  await page.route('**/api/workflows/*', async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').at(-1)!;
    const stored = api.files.get(id);
    if (request.method() === 'GET') {
      return stored
        ? json(route, 200, stored)
        : json(route, 404, { error: 'That workflow no longer exists.' });
    }
    if (request.method() === 'DELETE') {
      api.files.delete(id);
      return route.fulfill({ status: 204 });
    }
    const body = saveWorkflowSchema.parse(request.postDataJSON());
    api.saves.push({ id, baseHash: body.baseHash });
    if ((stored?.hash ?? null) !== body.baseHash) {
      return json(route, 409, {
        error: 'This workflow changed somewhere else. Go back and open it again.',
      });
    }
    api.put(body.workflow);
    return json(route, 200, api.files.get(id));
  });
  return api;
}

export async function addSpark(page: Page, name: string, role: string): Promise<string> {
  const response = await page.request.post('/api/teammates', { data: { name, role } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

export function step(id: string, sparkId: string, dependsOn: string[] = []) {
  return {
    id,
    sparkId,
    prompt: '',
    dependsOn,
    join: 'all' as const,
    onFailure: 'stop' as const,
  };
}
