import { EventType, stepMark, type RunEvent, type StepMark } from '@spark-outpost/contracts';
import { runEvents } from './run-events.ts';
import { attributed, subagentEvents, SUBAGENT_INTERRUPTED } from './subagent-events.ts';

export interface OpenSpans {
  observe(event: RunEvent): void;
  closers(): RunEvent[];
}

const INTERRUPTED_MESSAGE = 'The run ended before this agent finished.';

function subagentOf(event: RunEvent): string | null {
  const id = (event as { subagentRunId?: unknown }).subagentRunId;
  return typeof id === 'string' ? id : null;
}

export function trackOpenSpans(): OpenSpans {
  const steps = new Map<string, StepMark>();
  const toolCalls = new Set<string>();
  const reasoningMessages = new Set<string>();
  const reasoningSpans = new Set<string>();
  const subagents = new Set<string>();
  const subagentTexts = new Map<string, string>();
  return {
    observe(event) {
      if (event.type === EventType.STEP_STARTED) steps.set(event.stepName, stepMark(event));
      if (event.type === EventType.STEP_FINISHED) steps.delete(event.stepName);
      if (event.type === EventType.TOOL_CALL_START) toolCalls.add(event.toolCallId);
      if (event.type === EventType.TOOL_CALL_END) toolCalls.delete(event.toolCallId);
      if (event.type === EventType.REASONING_START) reasoningSpans.add(event.messageId);
      if (event.type === EventType.REASONING_END) reasoningSpans.delete(event.messageId);
      if (event.type === EventType.REASONING_MESSAGE_START) reasoningMessages.add(event.messageId);
      if (event.type === EventType.REASONING_MESSAGE_END) reasoningMessages.delete(event.messageId);
      if (event.type === EventType.SUBAGENT_STARTED) subagents.add(event.subagentRunId);
      if (event.type === EventType.SUBAGENT_FINISHED) subagents.delete(event.subagentRunId);
      if (event.type === EventType.SUBAGENT_ERROR) subagents.delete(event.subagentRunId);
      const subagent = subagentOf(event);
      if (event.type === EventType.TEXT_MESSAGE_START && subagent) {
        subagentTexts.set(event.messageId, subagent);
      }
      if (event.type === EventType.TEXT_MESSAGE_END) subagentTexts.delete(event.messageId);
    },
    closers() {
      const closing = [
        ...[...reasoningMessages].map(runEvents.reasoningMessageEnd),
        ...[...reasoningSpans].map(runEvents.reasoningEnd),
        ...[...toolCalls].map(runEvents.toolCallEnd),
        ...[...steps].map(([name, mark]) =>
          runEvents.stepFinished(name, { ...mark, interrupted: true }),
        ),
        ...[...subagentTexts].map(([messageId, subagent]) =>
          attributed(runEvents.textEnd(messageId), subagent)!,
        ),
        ...[...subagents].map((subagent) =>
          subagentEvents.error(subagent, INTERRUPTED_MESSAGE, SUBAGENT_INTERRUPTED),
        ),
      ];
      for (const open of [steps, toolCalls, reasoningMessages, reasoningSpans, subagents]) {
        open.clear();
      }
      subagentTexts.clear();
      return closing;
    },
  };
}
