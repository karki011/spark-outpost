import {
  PLAN_SAVED_OPTION,
  type PlanDocument,
  type PlanEntry,
  type PlanLineUnit,
} from '@spark-outpost/contracts';
import type { Session } from '../orchestration/session.ts';
import { insertPlanDocument, latestApprovedPlan } from '../persistence/plan-documents.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { announcePlan, approvalCommit, planSaveFailed } from '../workflow/plan-recorder.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { builtSinceApproval } from './plan-turn.ts';

interface PlannedPiece {
  title: string;
  goal: string;
  owns: readonly string[];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function filesOf(piece: PlannedPiece): string {
  if (piece.owns.length === 0) return '';
  return ` (${piece.owns.map((file) => `\`${file}\``).join(', ')})`;
}

export function piecesPlanBody(pieces: readonly PlannedPiece[]): string {
  return pieces
    .map(
      (piece, index) =>
        `${index + 1}. ${oneLine(piece.title)}: ${oneLine(piece.goal)}${filesOf(piece)}`,
    )
    .join('\n');
}

export function entriesPlanBody(entries: readonly PlanEntry[]): string | null {
  const steps = entries.map((entry) => oneLine(entry.content)).filter(Boolean);
  if (steps.length === 0) return null;
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

function savedAtBuild(plan: PlanDocument, runId: string): boolean {
  const option = plan.approvedOption;
  return (
    plan.sourceRunId === runId &&
    option !== null &&
    Object.values(PLAN_SAVED_OPTION).includes(option)
  );
}

async function replaces(s: Session, body: string): Promise<boolean> {
  const threadId = s.input.identity.threadId;
  const latest = await latestApprovedPlan(s.deps.db, threadId);
  if (!latest) return true;
  if (savedAtBuild(latest, s.lease.runId)) return latest.body !== body.trim();
  return builtSinceApproval(s.deps.db, threadId, latest, s.lease.runId);
}

export async function saveBuildPlan(
  s: Session,
  body: string,
  unit: PlanLineUnit,
): Promise<PlanDocument | null> {
  try {
    if (!(await replaces(s, body))) return null;
    const plan = await insertPlanDocument(s.deps.db, {
      conversationId: s.input.identity.threadId,
      taskId: s.taskId,
      source: 'chat',
      body,
      sourceRunId: s.lease.runId,
      approval: {
        by: s.intake.outcome.status === 'answered' ? 'jev' : 'user',
        option: PLAN_SAVED_OPTION[unit],
        runId: s.lease.runId,
        commit: await approvalCommit(s.input.projectRoots[0] ?? null).catch(() => null),
      },
    });
    await announcePlan(s.append, plan);
    return plan;
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    await planSaveFailed(s.append, error);
    return null;
  }
}

export interface BuilderPlanWatch {
  observe(output: ProviderOutput): void;
  settled(): Promise<void>;
}

export function watchBuilderPlan(s: Session): BuilderPlanWatch {
  let saving: Promise<void> = Promise.resolve();
  return {
    observe(output) {
      if (output.kind !== 'plan') return;
      const body = entriesPlanBody(output.entries);
      if (!body) return;
      saving = saving
        .then(async () => {
          await saveBuildPlan(s, body, 'steps');
        })
        .catch((error: unknown) => console.error("Could not save the Builder's plan", error));
    },
    settled: () => saving,
  };
}
