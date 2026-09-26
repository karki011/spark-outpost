import type { PlanEntry, PlanStatus } from '@spark-outpost/contracts';
import { latestPlan } from '../persistence/artifacts.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { nextPlanWrite } from '../tasks/plan-versions.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { MemberResult, Session } from './session.ts';
import { batchRanges } from './parallel.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

export type StepStatus = Exclude<PlanStatus, 'pending'>;

export function entriesForStep(
  entries: readonly PlanEntry[],
  stepIndex: number,
  ranges: readonly (readonly number[])[] | null = null,
): number[] {
  const kept = entries.flatMap((entry, index) => (entry.content.trim() ? [index] : []));
  const batch = (ranges ?? batchRanges(kept.length))[stepIndex] ?? [];
  return batch.flatMap((position) => (kept[position] === undefined ? [] : [kept[position]!]));
}

export function markStep(
  entries: readonly PlanEntry[],
  stepIndex: number,
  status: StepStatus,
  ranges: readonly (readonly number[])[] | null = null,
): PlanEntry[] {
  const targets = new Set(entriesForStep(entries, stepIndex, ranges));
  return entries.map((entry, index) => (targets.has(index) ? { ...entry, status } : entry));
}

function retriesBuilder(action: FlowAction): boolean {
  return action.type === 'spawn' && action.role === 'builder' && action.reason === 'retry';
}

export function statusAfterJudging(
  event: FlowEvent,
  action: FlowAction,
  builder: Pick<MemberResult, 'role' | 'outcome'> | undefined,
): StepStatus | null {
  if (event.type !== 'judged' || builder?.role !== 'builder') return null;
  if (action.type === 'ask' && action.kind === 'retry') return 'failed';
  if (retriesBuilder(action)) return null;
  return builder.outcome === 'succeeded' ? 'completed' : null;
}

const planWrites = new WeakMap<Session, Promise<void>>();

function serially(s: Session, write: () => Promise<void>): Promise<void> {
  const next = (planWrites.get(s) ?? Promise.resolve()).then(write);
  planWrites.set(
    s,
    next.catch(() => undefined),
  );
  return next;
}

export function markPlanStep(
  s: Session,
  stepIndex: number,
  status: StepStatus,
  sourceRunId: string,
): Promise<void> {
  return markPlanSteps(s, [stepIndex], status, sourceRunId);
}

export function markPlanSteps(
  s: Session,
  stepIndexes: readonly number[],
  status: StepStatus,
  sourceRunId: string,
): Promise<void> {
  const changes = stepIndexes.map((stepIndex): StepChange => [stepIndex, status]);
  return markPlanChanges(s, changes, sourceRunId);
}

export type StepChange = readonly [stepIndex: number, status: StepStatus];

export function markPlanChanges(
  s: Session,
  changes: readonly StepChange[],
  sourceRunId: string,
): Promise<void> {
  return serially(s, () => writeSteps(s, changes, sourceRunId));
}

const STEP_DONE = /\bstep (\d+) done\b/gi;

export function stepMarkers(text: string): number[] {
  return [...text.matchAll(STEP_DONE)].map((match) => Number(match[1]) - 1);
}

export interface StepTicker {
  ticked: number[];
  observe(output: ProviderOutput): void;
  settled(): Promise<void>;
}

export function stepTicker(s: Session, span: readonly number[], runId: string): StepTicker {
  let text = '';
  let writes = Promise.resolve();
  const ticked: number[] = [];
  return {
    ticked,
    observe(output) {
      if (output.kind !== 'text_delta' || span.length < 2) return;
      text += output.delta;
      const fresh = stepMarkers(text).filter((i) => span.includes(i) && !ticked.includes(i));
      if (fresh.length === 0) return;
      ticked.push(...fresh);
      const next = span.find((index) => !ticked.includes(index));
      const changes: StepChange[] = fresh.map((index) => [index, 'completed']);
      if (next !== undefined) changes.push([next, 'in_progress']);
      writes = writes.then(() => markPlanChanges(s, changes, runId)).catch(() => undefined);
    },
    settled: () => writes,
  };
}

async function writeSteps(
  s: Session,
  changes: readonly StepChange[],
  sourceRunId: string,
): Promise<void> {
  if (!s.taskId || s.plan.length === 0) return;
  const entries = changes.reduce<PlanEntry[]>(
    (current, [stepIndex, status]) => markStep(current, stepIndex, status, s.flow.ranges),
    s.plan,
  );
  s.plan = entries;
  const write = nextPlanWrite(await latestPlan(s.deps.db, s.taskId), entries);
  if (!write) return;
  const body = { entries };
  await s.append(runEvents.activity('artifact:plan', 'plan', { version: write.version, body }), {
    artifact: { taskId: s.taskId, kind: 'plan', body, sourceRunId, ...write },
  });
  s.planVersion = write.version;
}
