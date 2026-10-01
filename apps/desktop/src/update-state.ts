import type {
  InstallResult,
  UpdateChannel,
  UpdateStatus,
  UpdatesOffReason,
} from '@spark-outpost/contracts';

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 15_000;

export type UpdateEvent =
  | { type: 'checking'; at: Date }
  | { type: 'available'; version: string }
  | { type: 'skipped'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'channel'; channel: UpdateChannel };

export interface InitialStatus {
  currentVersion: string;
  channel: UpdateChannel;
  offReason: UpdatesOffReason | null;
  feedUrl: string | null;
}

export function initialStatus({
  currentVersion,
  channel,
  offReason,
  feedUrl,
}: InitialStatus): UpdateStatus {
  return {
    currentVersion,
    channel,
    phase: offReason ? 'off' : 'idle',
    offReason,
    availableVersion: null,
    progress: null,
    lastCheckedAt: null,
    error: null,
    skippedVersion: null,
    releaseNotesUrl: feedUrl ? `${feedUrl}/release-notes.html` : null,
  };
}

export function reduceUpdate(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  if (status.phase === 'off') {
    return event.type === 'channel' ? { ...status, channel: event.channel } : status;
  }
  switch (event.type) {
    case 'checking':
      if (status.phase === 'ready' || status.phase === 'downloading') {
        return { ...status, lastCheckedAt: event.at.toISOString() };
      }
      return { ...status, phase: 'checking', error: null, lastCheckedAt: event.at.toISOString() };
    case 'available':
      return { ...status, phase: 'downloading', availableVersion: event.version, progress: 0 };
    case 'skipped':
      return { ...status, phase: 'idle', availableVersion: null, skippedVersion: event.version };
    case 'not-available':
      if (status.phase === 'ready') return status;
      return { ...status, phase: 'idle', availableVersion: null, progress: null };
    case 'progress':
      if (status.phase !== 'downloading') return status;
      return { ...status, progress: Math.max(0, Math.min(100, Math.round(event.percent))) };
    case 'downloaded':
      return { ...status, phase: 'ready', availableVersion: event.version, progress: 100 };
    case 'error':
      if (status.phase === 'ready') return { ...status, error: event.message };
      return { ...status, phase: 'error', progress: null, error: event.message };
    case 'channel':
      if (status.phase === 'ready') return { ...status, channel: event.channel };
      return {
        ...status,
        channel: event.channel,
        phase: 'idle',
        availableVersion: null,
        progress: null,
      };
  }
}

export function updaterChannel(channel: UpdateChannel): 'latest' | 'beta' {
  return channel === 'beta' ? 'beta' : 'latest';
}

export function parseChannel(value: unknown): UpdateChannel | null {
  return value === 'stable' || value === 'beta' ? value : null;
}

function runWord(count: number): string {
  return count === 1 ? '1 run is' : `${count} runs are`;
}

export function installDecision(status: UpdateStatus, activeRuns: number | null): InstallResult {
  if (status.phase !== 'ready') return { started: false, reason: 'No update is ready yet.' };
  if (activeRuns === null) {
    return { started: false, reason: "Couldn't check for running work. Try again in a moment." };
  }
  if (activeRuns > 0) {
    return {
      started: false,
      reason: `${runWord(activeRuns)} still working. Restart once they finish or you stop them.`,
    };
  }
  return { started: true };
}
