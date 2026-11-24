import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteSession, RemoteSwitch } from '@spark-outpost/contracts';
import { rememberRemoteClient } from '../app/connection/remote-hint.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { hostWords } from '../desktop/host-words.ts';

export function phoneSwitchOff(): string {
  return `Turned off for remote control on your ${hostWords().computer}`;
}

const SESSION_FRESH_MS = 60_000;

export interface RemoteClient {
  remote: boolean;
  allows: (name: RemoteSwitch) => boolean;
  session: RemoteSession | undefined;
}

export function useRemoteClient(): RemoteClient {
  const session = useQuery({
    queryKey: phoneKeys.session,
    queryFn: phoneApi.session,
    staleTime: SESSION_FRESH_MS,
  });
  useEffect(() => {
    if (session.data) rememberRemoteClient(session.data.remote, session.data.host);
  }, [session.data]);
  const remote = session.data?.remote ?? false;
  const switches = session.data?.switches;
  return {
    remote,
    allows: (name) => !remote || (switches?.[name] ?? true),
    session: session.data,
  };
}
