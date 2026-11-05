import {
  AGENT_TERMINAL_STARTED,
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  EventType,
  FILE_FOCUS_ACTIVITY,
  SPARK_METADATA,
  type AgentTerminalStarted,
  type Approval,
  type FileFocus,
  type RunEvent,
  type StepMark,
} from '@spark-outpost/contracts';

export interface RunIdentity {
  runId: string;
  threadId: string;
  parentRunId?: string;
}

function marked(mark: StepMark | undefined): { metadata?: Record<string, StepMark> } {
  return mark && Object.keys(mark).length > 0 ? { metadata: { [SPARK_METADATA]: mark } } : {};
}

export const runEvents = {
  started: ({ runId, threadId, parentRunId }: RunIdentity): RunEvent => ({
    type: EventType.RUN_STARTED,
    runId,
    threadId,
    ...(parentRunId ? { parentRunId } : {}),
  }),
  finished: ({ runId, threadId }: RunIdentity): RunEvent => ({
    type: EventType.RUN_FINISHED,
    runId,
    threadId,
    outcome: { type: 'success' },
  }),
  cancelled: ({ runId, threadId }: RunIdentity): RunEvent => ({
    type: EventType.RUN_FINISHED,
    runId,
    threadId,
    outcome: { type: 'cancelled' },
  }),
  error: (message: string, code: string): RunEvent => ({
    type: EventType.RUN_ERROR,
    message,
    code,
  }),
  stepStarted: (stepName: string, mark?: StepMark, at?: number): RunEvent => ({
    type: EventType.STEP_STARTED,
    stepName,
    ...(at === undefined ? {} : { timestamp: at }),
    ...marked(mark),
  }),
  stepFinished: (stepName: string, mark?: StepMark, at?: number): RunEvent => ({
    type: EventType.STEP_FINISHED,
    stepName,
    ...(at === undefined ? {} : { timestamp: at }),
    ...marked(mark),
  }),
  fileFocus: ({ path, line, limit, action }: FileFocus): RunEvent => ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: FILE_FOCUS_ACTIVITY,
    activityType: FILE_FOCUS_ACTIVITY,
    content: { path, line, limit, action },
    replace: true,
  }),
  textStart: (messageId: string): RunEvent => ({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
  }),
  textContent: (messageId: string, delta: string): RunEvent => ({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta,
  }),
  textEnd: (messageId: string): RunEvent => ({ type: EventType.TEXT_MESSAGE_END, messageId }),
  reasoningStart: (messageId: string): RunEvent[] => [
    { type: EventType.REASONING_START, messageId },
    { type: EventType.REASONING_MESSAGE_START, messageId, role: 'reasoning' },
  ],
  reasoningContent: (messageId: string, delta: string): RunEvent => ({
    type: EventType.REASONING_MESSAGE_CONTENT,
    messageId,
    delta,
  }),
  reasoningMessageEnd: (messageId: string): RunEvent => ({
    type: EventType.REASONING_MESSAGE_END,
    messageId,
  }),
  reasoningEnd: (messageId: string): RunEvent => ({ type: EventType.REASONING_END, messageId }),
  toolCallStart: (toolCallId: string, toolCallName: string): RunEvent => ({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName,
  }),
  toolCallArgs: (toolCallId: string, delta: string): RunEvent => ({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta,
  }),
  toolCallEnd: (toolCallId: string): RunEvent => ({ type: EventType.TOOL_CALL_END, toolCallId }),
  toolCallResult: (messageId: string, toolCallId: string, content: string): RunEvent => ({
    type: EventType.TOOL_CALL_RESULT,
    messageId,
    toolCallId,
    content,
    role: 'tool',
  }),
  approvalRequested: (approval: Approval): RunEvent => ({
    type: EventType.CUSTOM,
    name: APPROVAL_REQUESTED,
    value: approval,
  }),
  approvalDecided: (approval: Approval): RunEvent => ({
    type: EventType.CUSTOM,
    name: APPROVAL_DECIDED,
    value: {
      id: approval.id,
      status: approval.status,
      decisionOptionId: approval.decisionOptionId,
      scope: approval.scope,
      decidedBy: approval.decidedBy,
      decidedAt: approval.decidedAt,
    },
  }),
  agentTerminalStarted: (started: AgentTerminalStarted): RunEvent => ({
    type: EventType.CUSTOM,
    name: AGENT_TERMINAL_STARTED,
    value: started,
  }),
  activity: (
    messageId: string,
    activityType: string,
    content: Record<string, unknown>,
  ): RunEvent => ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId,
    activityType,
    content,
    replace: true,
  }),
};
