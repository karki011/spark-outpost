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

const MAC_UNREACHABLE: OfflineCopy = {
  title: "Can't reach your Mac",
  body: 'It may be asleep, shut down or off Tailscale. Spark keeps trying and reconnects on its own.',
  mood: 'sleep',
};

const WAKE_HELP = 'Wake the Mac, or check that Tailscale is connected on this device.';

export function isMacUnreachable(kind: FailureKind, remote: boolean): boolean {
  return kind === 'unreachable' && remote;
}

export function offlineCopy(kind: FailureKind, remote: boolean): OfflineCopy {
  return isMacUnreachable(kind, remote) ? MAC_UNREACHABLE : COPY[kind];
}

export function backOnlineBody(remote: boolean): string {
  return remote ? 'Your Mac is answering again.' : 'The server is answering again.';
}

export function wakeHelp(kind: FailureKind, remote: boolean, failedAttempts: number): string {
  return isMacUnreachable(kind, remote) && failedAttempts >= HELP_AFTER_ATTEMPTS ? WAKE_HELP : '';
}
