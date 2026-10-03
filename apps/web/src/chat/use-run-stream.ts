import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  EventType,
  MEMBER_MESSAGE_ACTIVITY,
  ORCHESTRATION_ACTIVITY,
  isApprovalEvent,
  isTaskActivity,
  isTerminalRunEvent,
  parseRunEvent,
  type RunEvent,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { taskKeys } from '../tasks/task-api.ts';
import { applyRunEvent, initialRunProjection, type RunProjection } from './run-projection.ts';

function isOrchestrationActivity(event: RunEvent): boolean {
  return (
    event.type === EventType.ACTIVITY_SNAPSHOT &&
    (event.activityType === ORCHESTRATION_ACTIVITY ||
      event.activityType === MEMBER_MESSAGE_ACTIVITY)
  );
}

interface StreamState {
  runId: string;
  projection: RunProjection;
}

export function useRunStream(runId: string, conversationId: string, live = true): RunProjection {
  const [state, setState] = useState<StreamState>({ runId, projection: initialRunProjection });
  const [opened, setOpened] = useState(live);
  if (live && !opened) setOpened(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!opened) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    let queued: [number, RunEvent][] = [];
    let frame = 0;
    const apply = () => {
      frame = 0;
      const events = queued;
      queued = [];
      setState((current) => {
        let projection = current.runId === runId ? current.projection : initialRunProjection;
        for (const [seq, event] of events) projection = applyRunEvent(projection, seq, event);
        return { runId, projection };
      });
    };
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseRunEvent(JSON.parse(message.data));
      const seq = Number.parseInt(message.lastEventId, 10);
      if (!event || !Number.isInteger(seq)) return;
      queued.push([seq, event]);
      frame ||= requestAnimationFrame(apply);
      if (isTaskActivity(event) || isOrchestrationActivity(event) || isApprovalEvent(event)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      }
      if (isTaskActivity(event) || isTerminalRunEvent(event) || isApprovalEvent(event)) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      }
      if (isApprovalEvent(event)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
      }
      if (isTerminalRunEvent(event)) {
        source.close();
        cancelAnimationFrame(frame);
        apply();
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
        void queryClient.invalidateQueries({ queryKey: queryKeys.allCapabilities });
      }
    };
    return () => {
      source.close();
      cancelAnimationFrame(frame);
    };
  }, [runId, conversationId, queryClient, opened]);

  return state.runId === runId ? state.projection : initialRunProjection;
}
