import { EventType, type RunEvent } from '@spark-outpost/contracts';
import type { Append } from './agent-turn.ts';

export interface SubagentAnnounce {
  name: string;
  description?: string;
  parentMessageId?: string;
}

export const SUBAGENT_CANCELLED = 'cancelled';
export const SUBAGENT_INTERRUPTED = 'interrupted';

export const subagentEvents = {
  started: (subagentRunId: string, announce: SubagentAnnounce): RunEvent => ({
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: announce.name,
    ...(announce.description ? { description: announce.description } : {}),
    ...(announce.parentMessageId ? { parentMessageId: announce.parentMessageId } : {}),
  }),
  finished: (subagentRunId: string): RunEvent => ({
    type: EventType.SUBAGENT_FINISHED,
    subagentRunId,
    outcome: { type: 'success' },
  }),
  error: (subagentRunId: string, message: string, code: string): RunEvent => ({
    type: EventType.SUBAGENT_ERROR,
    subagentRunId,
    message,
    code,
  }),
};

const ATTRIBUTED = new Set<RunEvent['type']>([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.STEP_STARTED,
  EventType.STEP_FINISHED,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_RESULT,
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_END,
  EventType.ACTIVITY_SNAPSHOT,
  EventType.ACTIVITY_DELTA,
]);

export function attributed(event: RunEvent, subagentRunId: string): RunEvent | null {
  return ATTRIBUTED.has(event.type) ? ({ ...event, subagentRunId } as RunEvent) : null;
}

const REPLY_TEXT = new Set<RunEvent['type']>([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
]);

export interface SubagentOutcome {
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  error: string | null;
}

export interface SubagentBracket {
  mirroring(own: Append): Append;
  start(): Promise<void>;
  finish(result: SubagentOutcome): Promise<void>;
}

export function subagentBracket(
  parent: Append,
  subagentRunId: string,
  announce: SubagentAnnounce,
): SubagentBracket {
  let open = false;
  return {
    mirroring: (own) => async (event, options) => {
      const seq = await own(event, options);
      const copy = open && REPLY_TEXT.has(event.type) ? attributed(event, subagentRunId) : null;
      if (copy) await parent(copy);
      return seq;
    },
    async start() {
      await parent(subagentEvents.started(subagentRunId, announce));
      open = true;
    },
    async finish(result) {
      if (!open) return;
      open = false;
      if (result.outcome === 'succeeded') {
        await parent(subagentEvents.finished(subagentRunId));
      } else if (result.outcome === 'cancelled') {
        await parent(subagentEvents.error(subagentRunId, 'Stopped.', SUBAGENT_CANCELLED));
      } else {
        const message = result.error ?? 'The agent stopped before it finished.';
        await parent(subagentEvents.error(subagentRunId, message, SUBAGENT_INTERRUPTED));
      }
    },
  };
}
