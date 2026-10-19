import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarGoogleStatus, GoogleSignInFlow } from '@spark-outpost/contracts';
import { calendarApi, calendarKeys, type GoogleSignInStart } from './calendar-api.ts';

const POLL_MS = 1500;

function useGoogleSignIn(initial: GoogleSignInFlow, enabled: boolean) {
  const queryClient = useQueryClient();
  const flow = useQuery({
    queryKey: calendarKeys.googleSignIn,
    queryFn: calendarApi.googleSignIn,
    initialData: initial,
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  });
  const state = flow.data.status;
  useEffect(() => {
    if (state === 'connected') void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
  }, [state, queryClient]);
  const setFlow = (next: GoogleSignInFlow) =>
    queryClient.setQueryData(calendarKeys.googleSignIn, next);
  const start = useMutation({
    mutationFn: (request: GoogleSignInStart) => calendarApi.startGoogleSignIn(request),
    onSuccess: (next) => {
      setFlow(next);
      if (next.authorizeUrl) window.open(next.authorizeUrl, '_blank', 'noopener,noreferrer');
    },
  });
  const cancel = useMutation({ mutationFn: calendarApi.cancelGoogleSignIn, onSuccess: setFlow });
  return { flow: flow.data, start, cancel };
}

function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.disconnectGoogle,
    onSuccess: ({ status }) => {
      queryClient.setQueryData(calendarKeys.status, status);
      void queryClient.invalidateQueries({
        queryKey: calendarKeys.all,
        predicate: (query) => query.queryKey[1] !== 'status',
      });
    },
  });
}

export function useGoogleCalendar(google: CalendarGoogleStatus) {
  const { flow, start, cancel } = useGoogleSignIn(google.signIn, google.available);
  const disconnect = useDisconnectGoogle();
  const [note, setNote] = useState<string | null>(null);
  const [started, setStarted] = useState<GoogleSignInStart | null>(null);
  const waiting = flow.status === 'waiting';
  return {
    flow,
    waiting,
    editing: Boolean(started?.editCalendar),
    starting: start.isPending,
    busy: disconnect.isPending || waiting,
    flowNote: waiting ? null : flow.message,
    noteFor: started?.accountId ?? null,
    note,
    error: start.error ?? disconnect.error,
    begin: (request: GoogleSignInStart) => {
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

export type GoogleCalendar = ReturnType<typeof useGoogleCalendar>;
