import { EventType, type Event as AgUiEvent } from '@ag-ui/core';
import { EventSchema } from '@ag-ui/core/schemas';
import { z } from 'zod';
import { APPROVAL_DECIDED, APPROVAL_REQUESTED } from './approvals.ts';

export { EventType };
export type RunEvent = AgUiEvent;

export interface StoredRunEvent {
  seq: number;
  event: RunEvent;
}

export function parseRunEvent(value: unknown): RunEvent | null {
  const result = EventSchema.safeParse(value);
  return result.success ? (result.data as RunEvent) : null;
}

export const SPARK_METADATA = 'spark';

const stepMarkSchema = z.object({
  toolCallId: z.string().optional(),
  interrupted: z.boolean().optional(),
});
export type StepMark = z.infer<typeof stepMarkSchema>;

export function stepMark(event: { metadata?: Record<string, unknown> | undefined }): StepMark {
  const parsed = stepMarkSchema.safeParse(event.metadata?.[SPARK_METADATA]);
  return parsed.success ? parsed.data : {};
}

export function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

export const TASK_ACTIVITY_TYPES: readonly string[] = [
  'task',
  'plan',
  'link',
  'advice',
  'plan_document',
];

export function isTaskActivity(event: RunEvent): boolean {
  return (
    event.type === EventType.ACTIVITY_SNAPSHOT && TASK_ACTIVITY_TYPES.includes(event.activityType)
  );
}

export function isApprovalEvent(event: RunEvent): boolean {
  return (
    event.type === EventType.CUSTOM &&
    (event.name === APPROVAL_REQUESTED || event.name === APPROVAL_DECIDED)
  );
}
