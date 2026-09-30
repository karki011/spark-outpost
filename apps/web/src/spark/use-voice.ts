import { useQuery } from '@tanstack/react-query';
import { firstName } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import type { Voice } from './voice.ts';

export function useVoice(): Voice {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  return {
    personality: setup.data?.profile.personality ?? 'friendly',
    name: firstName(setup.data?.profile.displayName ?? ''),
  };
}
