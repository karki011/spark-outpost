import { gitDiffSince } from '../projects/snapshot.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import {
  architectPrompt,
  builderPrompt,
  criticPrompt,
  scoutPrompt,
  type ChangedFile,
} from './context.ts';
import { batchRanges } from './parallel.ts';
import type { Session } from './session.ts';
import { spanOf } from './spans.ts';
import type { Spawn } from './transitions.ts';
import { contractText, ordersForSteps, workOrdersText, type WorkOrder } from './work-orders.ts';

export interface ChangeSummary {
  files: ChangedFile[];
  patch: string;
}

export async function changesSoFar(s: Session): Promise<ChangeSummary> {
  const state = await getSnapshot(s.deps.db, s.input.workspaceId, s.lease.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return { files: [], patch: '' };
  const diff = await gitDiffSince(snapshot.root, snapshot.ref).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : { files: [], patch: '' };
}

export function planIndexes(s: Session, flowSteps: readonly number[]): number[] {
  const count = s.plannedCount ?? 0;
  if (count === 0) return [...flowSteps];
  const ranges = s.flow.ranges ?? batchRanges(count);
  return [...new Set(flowSteps.flatMap((index) => ranges[index] ?? []))].sort((a, b) => a - b);
}

export function ordersFor(s: Session, flowSteps: readonly number[]): WorkOrder[] {
  const orders = s.workOrders ?? [];
  if (orders.length === 0) return [];
  return ordersForSteps(orders, planIndexes(s, flowSteps));
}

export function contractFor(s: Session, flowSteps: readonly number[] | null): string | null {
  const orders = flowSteps ? ordersFor(s, flowSteps) : (s.workOrders ?? []);
  return contractText(orders);
}

export function checkCommands(s: Session): string[] {
  return s.checks?.commands.map((check) => check.command) ?? [];
}

export async function promptFor(s: Session, spawn: Spawn): Promise<string> {
  const request = s.input.userRequest;
  if (spawn.role === 'architect') {
    return architectPrompt({
      request,
      history: s.input.history,
      repos: s.input.projectRoots,
      previousPlan: s.plan.map((entry) => entry.content),
      note: spawn.note,
      buildStyle: s.buildStyle,
      workOrders: s.deps.handoff?.workOrders !== false,
    });
  }
  const plan = s.flow.steps.filter(Boolean);
  if (spawn.role === 'scout') {
    return scoutPrompt({ request, plan, stepIndex: spawn.stepIndex });
  }
  const changes = await changesSoFar(s);
  if (spawn.role === 'critic') {
    return criticPrompt({
      request,
      plan,
      changes: changes.files,
      patch: changes.patch,
      checks: [],
      buildStyle: s.buildStyle,
      contract: contractFor(s, null),
    });
  }
  const orders = ordersFor(s, spanOf(spawn));
  return builderPrompt({
    request,
    plan,
    stepIndex: spawn.stepIndex,
    carry: spawn.carry,
    architectNotes: s.architectNotes,
    earlierChanges: changes.files,
    note: spawn.note,
    findings: spawn.reason === 'retry' ? s.findings : [],
    research: s.research,
    ...(spawn.conflict ? { conflict: spawn.conflict } : {}),
    ...(spawn.checkFailures ? { checkFailures: spawn.checkFailures } : {}),
    buildStyle: s.buildStyle,
    workOrder: orders.length > 0 ? workOrdersText(orders) : null,
    checkCommands: checkCommands(s),
  });
}
