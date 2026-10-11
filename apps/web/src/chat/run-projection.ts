import {
  EventType,
  MODEL_SWITCH_ACTIVITY,
  ORCHESTRATION_ACTIVITY,
  modelSwitchSchema,
  orchestrationSchema,
  stepMark,
  type Approval,
  type ModelSwitch,
  type Orchestration,
  type AgentTerminalStarted,
  type RunEvent,
} from '@spark-outpost/contracts';
import { applyApprovalEvent } from './approvals/approval-events.ts';
import { applyAgentTerminalEvent } from './commands/agent-terminal-model.ts';
import { applyCommandEvent, type LiveCommand } from './commands/command-model.ts';
import {
  initialReplyStream,
  withTextDelta,
  withTextEnd,
  type ReplyStream,
} from './publish/reply-stream.ts';

export type LiveRunStatus = 'connecting' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunStep {
  name: string;
  done: boolean;
  toolCallId?: string | undefined;
  reasoningId?: string | undefined;
  thought?: string | undefined;
}

export type StepStatus = 'done' | 'failed' | 'open';

export interface StepView {
  name: string;
  status: StepStatus;
  reasoningId?: string | undefined;
  thought?: string | undefined;
}

function thinkingOf(step: RunStep): Pick<StepView, 'reasoningId' | 'thought'> {
  return {
    ...(step.reasoningId ? { reasoningId: step.reasoningId } : {}),
    ...(step.thought === undefined ? {} : { thought: step.thought }),
  };
}

function startedStep(event: Extract<RunEvent, { type: typeof EventType.STEP_STARTED }>): RunStep {
  const { toolCallId } = stepMark(event);
  return { name: event.stepName, done: false, ...(toolCallId ? { toolCallId } : {}) };
}

function finishStep(
  steps: readonly RunStep[],
  event: Extract<RunEvent, { type: typeof EventType.STEP_FINISHED }>,
): RunStep[] {
  const { toolCallId, interrupted } = stepMark(event);
  if (interrupted) return [...steps];
  const called = toolCallId
    ? steps.findIndex((step) => !step.done && step.toolCallId === toolCallId)
    : -1;
  const index =
    called >= 0 ? called : steps.findIndex((step) => !step.done && step.name === event.stepName);
  return steps.map((step, position) => (position === index ? { ...step, done: true } : step));
}

function withThought(steps: readonly RunStep[], reasoningId: string, delta: string): RunStep[] {
  return steps.map((step) =>
    step.reasoningId === reasoningId ? { ...step, thought: (step.thought ?? '') + delta } : step,
  );
}

function startThought(steps: readonly RunStep[], reasoningId: string): RunStep[] {
  const last = steps.at(-1);
  if (!last || last.done) return [...steps];
  return [...steps.slice(0, -1), { ...last, reasoningId, thought: '' }];
}

export function shownSteps(
  stream: Pick<RunProjection, 'steps'>,
  persisted: readonly RunStep[],
  leads: boolean,
): readonly RunStep[] {
  if (leads || persisted.length === 0) return stream.steps;
  const live = new Map(
    stream.steps.flatMap((step) =>
      step.reasoningId && step.thought !== undefined ? [[step.reasoningId, step.thought]] : [],
    ),
  );
  if (live.size === 0) return persisted;
  return persisted.map((step) => {
    const thought = step.reasoningId ? live.get(step.reasoningId) : undefined;
    return thought === undefined ? step : { ...step, thought };
  });
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
    views.push({ name: step.name, status: step.done ? 'done' : 'open', ...thinkingOf(step) });
  }
  return views;
}

export interface RunProjection extends ReplyStream {
  status: LiveRunStatus;
  steps: RunStep[];
  error: string | null;
  lastSeq: number;
  approvals: readonly Approval[];
  orchestration: Orchestration | null;
  modelSwitch: ModelSwitch | null;
  commands: readonly LiveCommand[];
  terminals: readonly AgentTerminalStarted[];
}

export const initialRunProjection: RunProjection = {
  ...initialReplyStream,
  status: 'connecting',
  steps: [],
  error: null,
  lastSeq: 0,
  approvals: [],
  orchestration: null,
  modelSwitch: null,
  commands: [],
  terminals: [],
};

export function applyRunEvent(state: RunProjection, seq: number, event: RunEvent): RunProjection {
  if (seq <= state.lastSeq) return state;
  const next = { ...state, lastSeq: seq };
  switch (event.type) {
    case EventType.RUN_STARTED:
      return { ...next, status: 'running' };
    case EventType.STEP_STARTED:
      return { ...next, steps: [...state.steps, startedStep(event)] };
    case EventType.STEP_FINISHED:
      return { ...next, steps: finishStep(state.steps, event) };
    case EventType.REASONING_START:
      return { ...next, steps: startThought(state.steps, event.messageId) };
    case EventType.REASONING_MESSAGE_CONTENT:
      return { ...next, steps: withThought(state.steps, event.messageId, event.delta) };
    case EventType.TEXT_MESSAGE_CONTENT:
      return event.subagentRunId ? next : withTextDelta(next, event.messageId, event.delta);
    case EventType.TEXT_MESSAGE_END: {
      if (event.subagentRunId) return next;
      const started = { commands: state.commands.length, terminals: state.terminals.length };
      return withTextEnd(next, event.messageId, started);
    }
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
      return {
        ...next,
        approvals: applyApprovalEvent(state.approvals, event),
        commands: applyCommandEvent(state.commands, event),
        terminals: applyAgentTerminalEvent(state.terminals, event),
      };
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
