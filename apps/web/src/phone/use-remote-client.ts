import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteSwitch } from '@spark-outpost/contracts';
import { rememberRemoteClient } from '../app/connection/remote-hint.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';

export const PHONE_SWITCH_OFF = 'Turned off for remote control on your Mac';

const SESSION_FRESH_MS = 60_000;

export interface RemoteClient {
  remote: boolean;
  allows: (name: RemoteSwitch) => boolean;
}

export function useRemoteClient(): RemoteClient {
  const session = useQuery({
    queryKey: phoneKeys.session,
    queryFn: phoneApi.session,
    staleTime: SESSION_FRESH_MS,
  });
  useEffect(() => {
    if (session.data) rememberRemoteClient(session.data.remote);
  }, [session.data]);
  const remote = session.data?.remote ?? false;
  const switches = session.data?.switches;
  return {
    remote,
    allows: (name) => !remote || (switches?.[name] ?? true),
  };
}
