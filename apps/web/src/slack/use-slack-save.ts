import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SlackStatus } from '@spark-outpost/contracts';
import { slackApi, slackKeys } from './slack-api.ts';

export function useSlackSave() {
  const queryClient = useQueryClient();
  const onSuccess = (status: SlackStatus) => queryClient.setQueryData(slackKeys.status, status);
  const settings = useMutation({ mutationFn: slackApi.updateSettings, onSuccess });
  const channels = useMutation({ mutationFn: slackApi.allowChannels, onSuccess });
  return {
    settings,
    channels,
    error: settings.error?.message ?? channels.error?.message ?? null,
  };
}

export type SlackSave = ReturnType<typeof useSlackSave>;
