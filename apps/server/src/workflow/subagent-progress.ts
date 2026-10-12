import {
  EventType,
  OWN_SUBAGENT_METADATA,
  SUBAGENTS_ACTIVITY,
  type RunEvent,
} from '@spark-outpost/contracts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';

export interface SubagentProgress {
  observe(output: ProviderOutput): RunEvent[];
}

interface ProgressOptions {
  storable: (text: string) => string;
  now?: () => number;
}

const END_MESSAGES = { failed: 'The sub-agent failed.', cancelled: 'Stopped.' } as const;

export function createSubagentProgress({
  storable,
  now = Date.now,
}: ProgressOptions): SubagentProgress {
  const working = new Set<string>();
  let ownOpen = 0;
  let waitingOn = 0;

  const lifecycle = (output: ProviderOutput): RunEvent[] => {
    if (output.kind === 'subagent_started') {
      if (working.has(output.id)) return [];
      working.add(output.id);
      const task = storable(output.task);
      return [
        {
          type: EventType.SUBAGENT_STARTED,
          subagentRunId: output.id,
          name: storable(output.name),
          ...(task ? { description: task } : {}),
          ...(output.parentId ? { parentSubagentRunId: output.parentId } : {}),
          timestamp: now(),
          metadata: OWN_SUBAGENT_METADATA,
        },
      ];
    }
    if (output.kind !== 'subagent_finished' || !working.delete(output.id)) return [];
    if (output.state === 'done') {
      return [
        {
          type: EventType.SUBAGENT_FINISHED,
          subagentRunId: output.id,
          outcome: { type: 'success' },
          timestamp: now(),
        },
      ];
    }
    return [
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: output.id,
        message: END_MESSAGES[output.state],
        code: output.state,
        timestamp: now(),
      },
    ];
  };

  const countOwn = (output: ProviderOutput) => {
    const own =
      (output.kind === 'step_started' || output.kind === 'step_finished') &&
      !output.subagent &&
      !output.waits;
    if (!own) return;
    ownOpen = output.kind === 'step_started' ? ownOpen + 1 : Math.max(0, ownOpen - 1);
  };

  return {
    observe(output) {
      const events = lifecycle(output);
      countOwn(output);
      const waiting = ownOpen === 0 ? working.size : 0;
      if (waiting === waitingOn) return events;
      waitingOn = waiting;
      return [
        ...events,
        runEvents.activity(SUBAGENTS_ACTIVITY, SUBAGENTS_ACTIVITY, { waitingOn: waiting }),
      ];
    },
  };
}
