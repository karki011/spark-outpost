import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GoogleSignInFlow, ZoomStatus } from '@spark-outpost/contracts';
import { openOutside } from '../browser/outside-link.ts';
import { zoomApi, zoomKeys } from './zoom-api.ts';

const POLL_MS = 1500;

export function useZoomStatus() {
  return useQuery({
    queryKey: zoomKeys.status,
    queryFn: zoomApi.status,
    refetchInterval: (query) => (query.state.data?.signIn.status === 'waiting' ? POLL_MS : false),
  });
}

export function useZoom(status: ZoomStatus) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const setFlow = (signIn: GoogleSignInFlow) =>
    queryClient.setQueryData<ZoomStatus>(zoomKeys.status, (known) =>
      known ? { ...known, signIn } : known,
    );
  const start = useMutation({
    mutationFn: zoomApi.startSignIn,
    onSuccess: (flow) => {
      setFlow(flow);
      if (flow.authorizeUrl) openOutside(flow.authorizeUrl);
    },
  });
  const cancel = useMutation({ mutationFn: zoomApi.cancelSignIn, onSuccess: setFlow });
  const disconnect = useMutation({
    mutationFn: zoomApi.disconnect,
    onSuccess: (result) => {
      queryClient.setQueryData(zoomKeys.status, result.status);
      setNote(result.message);
    },
  });
  const waiting = status.signIn.status === 'waiting';
  return {
    waiting,
    busy: start.isPending || disconnect.isPending || waiting,
    flowNote: waiting ? null : status.signIn.message,
    note,
    error: start.error ?? cancel.error ?? disconnect.error,
    connect: () => {
      setNote(null);
      start.mutate();
    },
    cancel: () => cancel.mutate(),
    disconnect: () => disconnect.mutate(),
  };
}
