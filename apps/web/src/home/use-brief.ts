import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_ATTENTION_SETTINGS,
  type AttentionSettings,
  type TicketInbox,
  type UpdateAttentionSettings,
} from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { digestView } from './digest-model.ts';
import { homeApi, homeKeys } from './home-api.ts';

export function useAttentionSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ticketKeys.attentionSettings,
    queryFn: ticketsApi.attentionSettings,
  });
  const save = useMutation({
    mutationFn: (update: UpdateAttentionSettings) => ticketsApi.updateAttentionSettings(update),
    onSuccess: (next: AttentionSettings) => {
      queryClient.setQueryData(ticketKeys.attentionSettings, next);
      queryClient.setQueryData<TicketInbox>(ticketKeys.inbox, (inbox) =>
        inbox ? { ...inbox, settings: next } : inbox,
      );
    },
  });
  return {
    settings: settings.data ?? DEFAULT_ATTENTION_SETTINGS,
    loaded: settings.isSuccess,
    save: save.mutateAsync,
  };
}

export function useBrief({ writeOnOpen }: { writeOnOpen: boolean }) {
  const queryClient = useQueryClient();
  const attention = useAttentionSettings();
  const digest = useQuery({ queryKey: homeKeys.digest, queryFn: homeApi.digest });
  const ask = useMutation({
    mutationFn: homeApi.requestDigest,
    onSuccess: (state) => queryClient.setQueryData(homeKeys.digest, state),
  });
  const askDigest = ask.mutate;

  useEffect(() => {
    if (writeOnOpen) askDigest('open');
  }, [askDigest, writeOnOpen]);

  const state = digest.data;
  const view = digestView(state);
  const enabled = attention.settings.briefEnabled;
  return {
    state,
    view,
    current: state?.digest ?? null,
    writing: view === 'writing' || ask.isPending,
    available: view !== 'hidden',
    enabled,
    on: view !== 'hidden' && enabled,
    error: ask.isError ? ask.error.message : null,
    refresh: () => ask.mutate('refresh'),
    turnOn: async () => {
      await attention.save({ briefEnabled: true });
      ask.mutate('refresh');
    },
  };
}

export type Brief = ReturnType<typeof useBrief>;
