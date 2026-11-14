import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Profile } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { setupApi, setupKey } from '../../api/setup.ts';
import { providerName } from '../provider-name.ts';
import { useTenSeconds } from './use-ten-seconds.ts';
import { roundWorker, type FollowUpMode, type IndicatorContext } from './watch-indicator-model.ts';

type FollowUpProfile = Pick<Profile, 'prFollowUp' | 'prFollowUpAsk'>;

export function followUpMode(profile: FollowUpProfile | null): FollowUpMode {
  if (!profile) return 'on';
  if (!profile.prFollowUp) return 'off';
  return profile.prFollowUpAsk ? 'ask' : 'on';
}

export interface WatchContext {
  mode: FollowUpMode;
  profile: Profile | null;
  contextFor: (roundRunId: string | null) => IndicatorContext;
}

export function useWatchContext(conversationId: string): WatchContext {
  const profile = useQuery({ queryKey: setupKey, queryFn: setupApi.get }).data?.profile ?? null;
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
    enabled: false,
  }).data;
  const now = useTenSeconds();
  return useMemo(() => {
    const mode = followUpMode(profile);
    return {
      mode,
      profile,
      contextFor: (roundRunId) => ({
        mode,
        now,
        worker: roundWorker(detail, roundRunId, providerName),
      }),
    };
  }, [profile, detail, now]);
}
