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

const COALESCE_MS = 150;

interface PendingRefresh {
  detail: boolean;
  tasks: boolean;
}

const clients = new WeakMap<QueryClient, RunStreamClient>();
const pendingRefreshes = new WeakMap<QueryClient, Map<string, PendingRefresh>>();

function refreshNow(queryClient: QueryClient, conversationId: string, due: PendingRefresh): void {
  if (due.detail) void invalidateChatDetail(queryClient, conversationId);
  if (due.tasks) void queryClient.invalidateQueries({ queryKey: taskKeys.all });
}

function takePending(queryClient: QueryClient, conversationId: string): PendingRefresh | null {
  const waiting = pendingRefreshes.get(queryClient);
  const due = waiting?.get(conversationId) ?? null;
  waiting?.delete(conversationId);
  return due;
}

function refreshSoon(queryClient: QueryClient, conversationId: string, add: PendingRefresh): void {
  const waiting = pendingRefreshes.get(queryClient) ?? new Map<string, PendingRefresh>();
  pendingRefreshes.set(queryClient, waiting);
  const queued = waiting.get(conversationId);
  if (queued) {
    queued.detail ||= add.detail;
    queued.tasks ||= add.tasks;
    return;
  }
  waiting.set(conversationId, { ...add });
  setTimeout(() => {
    const due = takePending(queryClient, conversationId);
    if (due) refreshNow(queryClient, conversationId, due);
  }, COALESCE_MS);
}

export function refreshAfter(
  queryClient: QueryClient,
  conversationId: string,
  event: RunEvent,
): void {
  const urgent = isApprovalEvent(event) || isTerminalRunEvent(event);
  const wanted = {
    detail: refreshesChat(event),
    tasks: isTaskActivity(event) || urgent,
  };
  if (urgent) {
    takePending(queryClient, conversationId);
    refreshNow(queryClient, conversationId, wanted);
  } else if (wanted.detail || wanted.tasks) {
    refreshSoon(queryClient, conversationId, wanted);
  }
  if (isApprovalEvent(event)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
  }
  if (isTerminalRunEvent(event)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
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
