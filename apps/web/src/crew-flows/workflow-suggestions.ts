import type { WorkflowStep } from '@spark-outpost/contracts';
import { addStage, addStep, type SparkName } from './workflow-model.ts';

export interface WorkflowSuggestion {
  id: string;
  name: string;
  detail: string;
  steps: WorkflowStep[];
}

const SIDE_BY_SIDE_MAX = 4;

function sideBySide(sparks: readonly SparkName[]): WorkflowStep[] {
  return sparks.reduce<WorkflowStep[]>((steps, spark) => addStep(steps, 0, spark), []);
}

function inOrder(sparks: readonly SparkName[]): WorkflowStep[] {
  return sparks.reduce<WorkflowStep[]>((steps, spark) => addStage(steps, spark), []);
}

export function suggestWorkflows(sparks: readonly SparkName[]): WorkflowSuggestion[] {
  const crew = sparks.slice(0, SIDE_BY_SIDE_MAX);
  if (crew.length < 2) return [];
  const last = crew[crew.length - 1]!;
  const suggestions: WorkflowSuggestion[] = [
    {
      id: 'side-by-side',
      name: 'Side by side',
      detail: 'Everyone works at the same time.',
      steps: sideBySide(crew),
    },
    {
      id: 'in-order',
      name: 'One after another',
      detail: 'Each Spark waits for the one before it.',
      steps: inOrder(crew),
    },
  ];
  if (crew.length >= 3) {
    suggestions.push({
      id: 'wrap-up',
      name: `Then ${last.name} wraps up`,
      detail: `The others work together, then ${last.name} gets their notes.`,
      steps: addStage(sideBySide(crew.slice(0, -1)), last),
    });
  }
  return suggestions;
}
