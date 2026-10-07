import { EventType, stepMark, type RunEvent, type StepMark } from '@spark-outpost/contracts';
import { runEvents } from './run-events.ts';

export interface OpenSpans {
  observe(event: RunEvent): void;
  closers(): RunEvent[];
}

export function trackOpenSpans(): OpenSpans {
  const steps = new Map<string, StepMark>();
  const toolCalls = new Set<string>();
  const reasoningMessages = new Set<string>();
  const reasoningSpans = new Set<string>();
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
    },
    closers() {
      const closing = [
        ...[...reasoningMessages].map(runEvents.reasoningMessageEnd),
        ...[...reasoningSpans].map(runEvents.reasoningEnd),
        ...[...toolCalls].map(runEvents.toolCallEnd),
        ...[...steps].map(([name, mark]) =>
          runEvents.stepFinished(name, { ...mark, interrupted: true }),
        ),
      ];
      for (const open of [steps, toolCalls, reasoningMessages, reasoningSpans]) open.clear();
      return closing;
    },
  };
}
