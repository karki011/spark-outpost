import type { PlanDocument, PlanDocumentSource } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  approvePlanDocument,
  insertPlanDocument,
  latestPlanBody,
  rejectPlanDocument,
} from '../persistence/plan-documents.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { isExitPlanAllow } from '../plans/plan-mode.ts';
import { headCommit } from '../projects/snapshot.ts';
import type { GateAnswer } from '../providers/provider.ts';
import type { Append } from './agent-turn.ts';
import type { PlanModeHooks } from './approval-gate.ts';
import { runEvents } from './run-events.ts';

export const PLAN_SAVE_FAILED = 'Error: Could not save the plan';

export interface PlanRecorderDeps {
  db: Db;
  runId: string;
  conversationId: string;
  root: string | null;
  taskId: () => Promise<string | null>;
  append: Append;
}

export interface PlanRecorder {
  propose(body: string, source: PlanDocumentSource, toolCallId?: string): Promise<string | null>;
  hooks: PlanModeHooks;
}

export async function approvalCommit(root: string | null): Promise<string | null> {
  return root ? headCommit(root) : null;
}

async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

export function announcePlan(append: Append, plan: PlanDocument): Promise<void> {
  return quietly(() =>
    append(
      runEvents.activity(`plan_document:${plan.id}`, 'plan_document', {
        id: plan.id,
        version: plan.version,
        status: plan.status,
        source: plan.source,
      }),
    ),
  );
}

export function planNote(append: Append, name: string): Promise<void> {
  return quietly(async () => {
    await append(runEvents.stepStarted(name));
    await append(runEvents.stepFinished(name));
  });
}

export async function planSaveFailed(append: Append, error: unknown): Promise<string> {
  console.error('Could not save a plan document', error);
  const reason = error instanceof Error ? error.message : 'unknown error';
  await planNote(append, `${PLAN_SAVE_FAILED}: ${reason}`);
  return reason;
}

export function createPlanRecorder(deps: PlanRecorderDeps): PlanRecorder {
  const announce = (plan: PlanDocument) => announcePlan(deps.append, plan);
  const failed = (error: unknown) => planSaveFailed(deps.append, error);

  const repeated = async (body: string) =>
    (await latestPlanBody(deps.db, deps.conversationId)) === body.trim();

  const propose = async (body: string, source: PlanDocumentSource, toolCallId?: string) => {
    try {
      if (source === 'codex' && (await repeated(body))) return null;
      const plan = await insertPlanDocument(deps.db, {
        conversationId: deps.conversationId,
        taskId: await deps.taskId(),
        source,
        body,
        sourceRunId: deps.runId,
        toolCallId: toolCallId ?? null,
      });
      await announce(plan);
      return plan.id;
    } catch (error) {
      await failed(error);
      return null;
    }
  };

  const settlePlan = async (
    planId: string,
    answer: Extract<GateAnswer, { outcome: 'selected' }>,
  ): Promise<PlanDocument | null> => {
    const approvalId = answer.approvalId ?? null;
    if (!answer.allowed) return rejectPlanDocument(deps.db, planId, approvalId);
    if (!isExitPlanAllow(answer.optionId)) return null;
    return approvePlanDocument(deps.db, planId, {
      by: 'user',
      option: answer.optionId,
      runId: deps.runId,
      commit: await approvalCommit(deps.root).catch(() => null),
      approvalId,
    });
  };

  const decided = async (planId: string, answer: GateAnswer) => {
    if (answer.outcome !== 'selected') return;
    try {
      const plan = await settlePlan(planId, answer);
      if (plan) await announce(plan);
    } catch (error) {
      await failed(error);
    }
  };

  return {
    propose,
    hooks: {
      proposed: (request) => propose(request.plan, 'claude_plan_mode', request.toolCallId),
      decided,
    },
  };
}
