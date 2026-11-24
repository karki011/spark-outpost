import { hostWords } from '../../desktop/host-words.ts';
import type { FailureKind } from './connection-failure.ts';

export interface OfflineCopy {
  title: string;
  body: string;
  mood: 'sleep' | 'sad';
}

export const HELP_AFTER_ATTEMPTS = 4;

const COPY: Record<FailureKind, OfflineCopy> = {
  unreachable: {
    title: 'Taking a quick nap',
    body: "The Spark Outpost server isn't answering. It may be restarting.",
    mood: 'sleep',
  },
  server: {
    title: 'Feeling a little dizzy',
    body: 'Something went wrong on the server.',
    mood: 'sad',
  },
};

function hostUnreachable(): OfflineCopy {
  return {
    title: `Can't reach your ${hostWords().computer}`,
    body: 'It may be asleep, shut down or off Tailscale. Spark keeps trying and reconnects on its own.',
    mood: 'sleep',
  };
}

function wakeHostHelp(): string {
  return `Wake the ${hostWords().computer}, or check that Tailscale is connected on this device.`;
}

export function isMacUnreachable(kind: FailureKind, remote: boolean): boolean {
  return kind === 'unreachable' && remote;
}

export function offlineCopy(kind: FailureKind, remote: boolean): OfflineCopy {
  return isMacUnreachable(kind, remote) ? hostUnreachable() : COPY[kind];
}

export function backOnlineBody(remote: boolean): string {
  return remote
    ? `Your ${hostWords().computer} is answering again.`
    : 'The server is answering again.';
}

export function wakeHelp(kind: FailureKind, remote: boolean, failedAttempts: number): string {
  return isMacUnreachable(kind, remote) && failedAttempts >= HELP_AFTER_ATTEMPTS
    ? wakeHostHelp()
    : '';
}
