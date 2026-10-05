import {
  EventType,
  MODEL_SWITCH_ACTIVITY,
  ORCHESTRATION_ACTIVITY,
  modelSwitchSchema,
  orchestrationSchema,
  type Approval,
  type ModelSwitch,
  type Orchestration,
  type RunEvent,
} from '@spark-outpost/contracts';
import { applyApprovalEvent } from './approvals/approval-events.ts';

export type LiveRunStatus = 'connecting' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunStep {
  name: string;
  done: boolean;
}

export type StepStatus = 'done' | 'failed' | 'open';

export interface StepView {
  name: string;
  status: StepStatus;
}

const FAILED_PREFIX = 'Failed: ';

export function viewSteps(steps: readonly RunStep[]): StepView[] {
  const views: StepView[] = [];
  for (const step of steps) {
    const failedName = step.name.startsWith(FAILED_PREFIX)
      ? step.name.slice(FAILED_PREFIX.length)
      : null;
    const failedStep =
      failedName === null
        ? undefined
        : views.findLast((view) => view.name === failedName && view.status === 'done');
    if (failedStep) {
      failedStep.status = 'failed';
      continue;
    }
    views.push({ name: step.name, status: step.done ? 'done' : 'open' });
  }
  return views;
}

export interface RunProjection {
  status: LiveRunStatus;
  steps: RunStep[];
  text: string;
  error: string | null;
  lastSeq: number;
  approvals: readonly Approval[];
  orchestration: Orchestration | null;
  modelSwitch: ModelSwitch | null;
}

export const initialRunProjection: RunProjection = {
  status: 'connecting',
  steps: [],
  text: '',
  error: null,
  lastSeq: 0,
  approvals: [],
  orchestration: null,
  modelSwitch: null,
};

export function applyRunEvent(state: RunProjection, seq: number, event: RunEvent): RunProjection {
  if (seq <= state.lastSeq) return state;
  const next = { ...state, lastSeq: seq };
  switch (event.type) {
    case EventType.RUN_STARTED:
      return { ...next, status: 'running' };
    case EventType.STEP_STARTED:
      return { ...next, steps: [...state.steps, { name: event.stepName, done: false }] };
    case EventType.STEP_FINISHED:
      return {
        ...next,
        steps: state.steps.map((step) =>
          step.name === event.stepName && !step.done ? { ...step, done: true } : step,
        ),
      };
    case EventType.TEXT_MESSAGE_CONTENT:
      return { ...next, text: state.text + event.delta };
    case EventType.RUN_FINISHED:
      return { ...next, status: event.outcome?.type === 'cancelled' ? 'cancelled' : 'succeeded' };
    case EventType.RUN_ERROR:
      return { ...next, status: 'failed', error: event.message };
    case EventType.ACTIVITY_SNAPSHOT: {
      if (event.activityType === MODEL_SWITCH_ACTIVITY) {
        const change = modelSwitchSchema.safeParse(event.content);
        return change.success ? { ...next, modelSwitch: change.data } : next;
      }
      if (event.activityType !== ORCHESTRATION_ACTIVITY) return next;
      const parsed = orchestrationSchema.safeParse(event.content);
      return parsed.success ? { ...next, orchestration: parsed.data } : next;
    }
    case EventType.CUSTOM:
      return { ...next, approvals: applyApprovalEvent(state.approvals, event) };
    default:
      return next;
  }
}

export function streamLeads(stream: RunProjection, finished: boolean): boolean {
  if (!finished) return true;
  const catchingUp = stream.status === 'connecting' || stream.status === 'running';
  return catchingUp && stream.lastSeq > 0;
}

export function shownText(
  stream: RunProjection,
  persisted: string | undefined,
  finished: boolean,
): string {
  if (streamLeads(stream, finished) || !persisted) return stream.text;
  return persisted;
}
