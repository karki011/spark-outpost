import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflowStepSchema, type WorkflowRun, type WorkflowStep } from '@spark-outpost/contracts';
import { workflowRunForTurn } from '../src/crew-flows/run-records.ts';
import { workspaceSparkIds } from '../src/crew-flows/step-sparks.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { replyText } from '../src/persistence/spark-mentions.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import type { TestDb } from './support.ts';

export async function useWorkflowsDir(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(join(tmpdir(), 'spark-workflows-'));
  process.env.SPARK_WORKFLOWS_DIR = dir;
  return async () => {
    delete process.env.SPARK_WORKFLOWS_DIR;
    await rm(dir, { recursive: true, force: true });
  };
}

export function newSpark(t: TestDb, name: string, extra: Record<string, unknown> = {}) {
  return createTeammate(t.db, t.workspaceId, {
    name,
    role: 'Code reviewer',
    provider: null,
    model: null,
    agentMode: null,
    level: null,
    instructions: 'Name the file and line you mean.',
    projectIds: [],
    ...extra,
  });
}

export function step(id: string, sparkId: string, extra: Partial<WorkflowStep> = {}): WorkflowStep {
  return workflowStepSchema.parse({ id, sparkId, ...extra });
}

export async function saveFlow(t: TestDb, id: string, steps: WorkflowStep[]): Promise<void> {
  const sparkIds = await workspaceSparkIds(t.db, t.workspaceId);
  await workflowStore().save({ id, name: `Flow ${id}`, steps }, null, sparkIds);
}

export async function recordOf(t: TestDb, runId: string): Promise<WorkflowRun | null> {
  return (await workflowRunForTurn(t.db, runId))?.run ?? null;
}

export function statesOf(run: WorkflowRun | null): Record<string, string> {
  return Object.fromEntries((run?.steps ?? []).map((entry) => [entry.stepId, entry.state]));
}

export async function stepReply(t: TestDb, run: WorkflowRun | null, id: string): Promise<string> {
  const runId = run?.steps.find((entry) => entry.stepId === id)?.runId;
  return runId ? replyText(t.db, runId) : '';
}
