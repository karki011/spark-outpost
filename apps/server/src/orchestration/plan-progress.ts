import type { PlanEntry } from '@spark-outpost/contracts';
import { latestPlan } from '../persistence/artifacts.ts';
import type { Session } from './session.ts';

export function openEntries(entries: readonly PlanEntry[]): string[] {
  return entries
    .filter((entry) => entry.content.trim() && entry.status !== 'completed')
    .map((entry) => entry.content.trim());
}

async function builderPlan(s: Session, runIds: readonly string[]): Promise<PlanEntry[]> {
  if (!s.taskId) return [];
  const plan = await latestPlan(s.deps.db, s.taskId);
  if (!plan || !runIds.includes(plan.sourceRunId ?? '')) return [];
  return [...plan.entries];
}

export async function refreshPlan(s: Session): Promise<string[]> {
  const builders = s.results.filter((result) => result.role === 'builder').map((r) => r.runId);
  s.plan = await builderPlan(s, builders);
  return openEntries(s.plan);
}
