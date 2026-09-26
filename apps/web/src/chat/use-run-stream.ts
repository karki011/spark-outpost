import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  EventType,
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
    event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === ORCHESTRATION_ACTIVITY
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
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseRunEvent(JSON.parse(message.data));
      const seq = Number.parseInt(message.lastEventId, 10);
      if (!event || !Number.isInteger(seq)) return;
      setState((current) => {
        const base = current.runId === runId ? current.projection : initialRunProjection;
        return { runId, projection: applyRunEvent(base, seq, event) };
      });
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
      }
    };
    return () => source.close();
  }, [runId, conversationId, queryClient, opened]);

  return state.runId === runId ? state.projection : initialRunProjection;
}
