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
  if (action.action === 'update_teammate') return 'Spark changes';
  const thing = action.target === 'workflow' ? 'workflow' : 'Spark';
  return allNew(action) ? `New ${thing}` : `${thing === 'workflow' ? 'Workflow' : 'Spark'} changes`;
}

export function crewReviewName(action: CrewReviewAction): string {
  return action.name.trim() || crewReviewKind(action);
}

let wanted: string | null = null;
const listeners = new Set<() => void>();

export function requestCrewReview(approvalId: string): void {
  wanted = approvalId;
  listeners.forEach((listener) => listener());
}

export function useCrewReviewRequest(approvalId: string, open: () => void): void {
  useEffect(() => {
    const take = () => {
      if (wanted !== approvalId) return;
      wanted = null;
      open();
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [approvalId, open]);
}
