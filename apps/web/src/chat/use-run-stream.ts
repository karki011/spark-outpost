import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  isApprovalEvent,
  isTaskActivity,
  isTerminalRunEvent,
  type RunEvent,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { taskKeys } from '../tasks/task-api.ts';
import { refreshesChat } from './run-refresh.ts';
import { RunStreamClient } from './run-stream-client.ts';
import { applyRunEvent, initialRunProjection, type RunProjection } from './run-projection.ts';
import { invalidateChatDetail } from '../api/chat-detail.ts';

interface StreamState {
  runId: string;
  projection: RunProjection;
}

const clients = new WeakMap<QueryClient, RunStreamClient>();
function refreshAfter(queryClient: QueryClient, conversationId: string, event: RunEvent): void {
  if (refreshesChat(event)) {
    void invalidateChatDetail(queryClient, conversationId);
  }
  if (isTaskActivity(event) || isTerminalRunEvent(event) || isApprovalEvent(event)) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  }
  if (isApprovalEvent(event)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
  }
  if (isTerminalRunEvent(event)) {
    void invalidateChatDetail(queryClient, conversationId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.annotations(conversationId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allCapabilities });
  }
}

export function runStreamClient(queryClient: QueryClient): RunStreamClient {
  let client = clients.get(queryClient);
  if (!client) {
    client = new RunStreamClient((conversationId, event) =>
      refreshAfter(queryClient, conversationId, event),
    );
    clients.set(queryClient, client);
  }
  return client;
}

export function useRunStream(runId: string, conversationId: string, live = true): RunProjection {
  const [state, setState] = useState<StreamState>({ runId, projection: initialRunProjection });
  const [opened, setOpened] = useState(live);
  if (live && !opened) setOpened(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!opened) return;
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
    const unsubscribe = runStreamClient(queryClient).subscribe(runId, conversationId, {
      event(seq, event) {
        queued.push([seq, event]);
        if (isTerminalRunEvent(event)) {
          cancelAnimationFrame(frame);
          apply();
          return;
        }
        frame ||= requestAnimationFrame(apply);
      },
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [runId, conversationId, queryClient, opened]);

  return state.runId === runId ? state.projection : initialRunProjection;
}
