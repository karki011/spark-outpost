import { useEffect } from 'react';
import type { SparkAction } from '@spark-outpost/contracts';

export type CrewReviewAction = Extract<
  SparkAction,
  { action: 'create_teammate' | 'update_teammate' | 'crew_edit' }
>;

export function isCrewReview(action: SparkAction): action is CrewReviewAction {
  return (
    action.action === 'create_teammate' ||
    action.action === 'update_teammate' ||
    action.action === 'crew_edit'
  );
}

function allNew(action: CrewReviewAction): boolean {
  return action.action === 'crew_edit' && action.files.every((file) => file.change === 'new');
}

export function crewReviewKind(action: CrewReviewAction): string {
  if (action.action === 'create_teammate') return 'New Spark';
  if (action.action === 'update_teammate' || action.target === 'spark') return 'Spark changes';
  return allNew(action) ? 'New workflow' : 'Workflow changes';
}

export function crewReviewName(action: CrewReviewAction): string {
  return action.name.trim() || crewReviewKind(action);
}

const UNCLAIMED_MS = 10_000;

let wanted: { id: string; claimed: boolean } | null = null;
const listeners = new Set<() => void>();

export function requestCrewReview(approvalId: string): void {
  const request = { id: approvalId, claimed: false };
  wanted = request;
  listeners.forEach((listener) => listener());
  setTimeout(() => {
    if (wanted === request && !request.claimed) wanted = null;
  }, UNCLAIMED_MS);
}

export function endCrewReview(approvalId: string): void {
  if (wanted?.id === approvalId) wanted = null;
}

export function useCrewReviewRequest(approvalId: string, open: () => void): void {
  useEffect(() => {
    const take = () => {
      if (wanted?.id !== approvalId) return;
      wanted.claimed = true;
      open();
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [approvalId, open]);
}
