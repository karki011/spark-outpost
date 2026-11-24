import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoogleSignInFlow } from '@spark-outpost/contracts';
import {
  calendarApi,
  calendarKeys,
  type CloudProvider,
  type CloudSignInStart,
} from './calendar-api.ts';
import { openOutside } from '../browser/outside-link.ts';

const POLL_MS = 1500;

interface CloudStatus {
  available: boolean;
  signIn: GoogleSignInFlow;
}

function useCloudSignIn(provider: CloudProvider, initial: GoogleSignInFlow, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = calendarKeys.signIn(provider);
  const flow = useQuery({
    queryKey: key,
    queryFn: () => calendarApi.signIn(provider),
    initialData: initial,
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  });
  const state = flow.data.status;
  useEffect(() => {
    if (state === 'connected') void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
  }, [state, queryClient]);
  const setFlow = (next: GoogleSignInFlow) => queryClient.setQueryData(key, next);
  const start = useMutation({
    mutationFn: (request: CloudSignInStart) => calendarApi.startSignIn(provider, request),
    onSuccess: (next) => {
      setFlow(next);
      if (next.authorizeUrl) openOutside(next.authorizeUrl);
    },
  });
  const cancel = useMutation({
    mutationFn: () => calendarApi.cancelSignIn(provider),
    onSuccess: setFlow,
  });
  return { flow: flow.data, start, cancel };
}

function useDisconnect(provider: CloudProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => calendarApi.disconnectAccount(provider, accountId),
    onSuccess: ({ status }) => {
      queryClient.setQueryData(calendarKeys.status, status);
      void queryClient.invalidateQueries({
        queryKey: calendarKeys.all,
        predicate: (query) => query.queryKey[1] !== 'status',
      });
    },
  });
}

export function useCloudCalendar(provider: CloudProvider, status: CloudStatus) {
  const { flow, start, cancel } = useCloudSignIn(provider, status.signIn, status.available);
  const disconnect = useDisconnect(provider);
  const [note, setNote] = useState<string | null>(null);
  const [started, setStarted] = useState<CloudSignInStart | null>(null);
  const waiting = flow.status === 'waiting';
  return {
    provider,
    flow,
    waiting,
    editing: Boolean(started?.editCalendar),
    starting: start.isPending,
    busy: disconnect.isPending || waiting,
    flowNote: waiting ? null : flow.message,
    noteFor: started?.accountId ?? null,
    note,
    error: start.error ?? disconnect.error,
    begin: (request: CloudSignInStart) => {
      setStarted(request);
      start.mutate(request);
    },
    cancel: () => cancel.mutate(),
    remove: (accountId: string) => {
      setNote(null);
      disconnect.mutate(accountId, { onSuccess: (result) => setNote(result.message) });
    },
  };
}

export type CloudCalendar = ReturnType<typeof useCloudCalendar>;
