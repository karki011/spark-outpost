import {
  WAITING_FOR_RUNS,
  type InstallResult,
  type UpdateChannel,
  type UpdateStatus,
  type UpdatesOffReason,
} from '@spark-outpost/contracts';

export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 15_000;
export const RUNS_RECHECK_MS = 15_000;
export const INSTALL_STALL_TIMEOUT_MS = 90_000;
export const RESTART_RECHECK_TIMEOUT_MS = 5_000;
export const QUIT_RECHECK_TIMEOUT_MS = 2_000;
export const INSTALL_STALLED_MESSAGE =
  "The update didn't start. Quit Spark and open it again, or try Restart to update once more.";

export type UpdateEvent =
  | { type: 'checking'; at: Date }
  | { type: 'available'; version: string }
  | { type: 'download-started'; version: string }
  | { type: 'skipped'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'install-requested' }
  | { type: 'waiting' }
  | { type: 'installing' }
  | { type: 'error'; message: string }
  | { type: 'channel'; channel: UpdateChannel }
  | { type: 'auto-download'; on: boolean };

export interface InitialStatus {
  currentVersion: string;
  channel: UpdateChannel;
  autoDownload: boolean;
  offReason: UpdatesOffReason | null;
  feedUrl: string | null;
  devBuild?: boolean;
  preview?: boolean;
  previewUpdatedTo?: string | null;
}

export function initialStatus(initial: InitialStatus): UpdateStatus {
  return {
    currentVersion: initial.currentVersion,
    channel: initial.channel,
    autoDownload: initial.autoDownload,
    phase: initial.offReason ? 'off' : 'idle',
    offReason: initial.offReason,
    availableVersion: null,
    progress: null,
    installRequested: false,
    waitingForRuns: false,
    lastCheckedAt: null,
    error: null,
    skippedVersion: null,
    releaseNotesUrl: initial.feedUrl ? `${initial.feedUrl}/release-notes.html` : null,
    devBuild: initial.devBuild ?? false,
    preview: initial.preview ?? false,
    previewUpdatedTo: initial.previewUpdatedTo ?? null,
  };
}

const HOLDS_AN_UPDATE = new Set(['available', 'downloading', 'ready', 'installing']);

function settings(status: UpdateStatus, event: UpdateEvent): UpdateStatus | null {
  if (event.type === 'auto-download') return { ...status, autoDownload: event.on };
  if (event.type !== 'channel') return null;
  if (status.phase === 'off' || status.phase === 'ready' || status.phase === 'installing') {
    return { ...status, channel: event.channel };
  }
  return {
    ...status,
    channel: event.channel,
    phase: 'idle',
    availableVersion: null,
    progress: null,
    installRequested: false,
    waitingForRuns: false,
  };
}

export function reduceUpdate(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  const changed = settings(status, event);
  if (changed) return changed;
  if (status.phase === 'off') return status;
  switch (event.type) {
    case 'checking':
      if (HOLDS_AN_UPDATE.has(status.phase)) {
        return { ...status, error: null, lastCheckedAt: event.at.toISOString() };
      }
      return { ...status, phase: 'checking', error: null, lastCheckedAt: event.at.toISOString() };
    case 'available':
      return { ...status, phase: 'available', availableVersion: event.version, progress: null };
    case 'download-started':
      return { ...status, phase: 'downloading', availableVersion: event.version, progress: 0 };
    case 'skipped':
      return { ...status, phase: 'idle', availableVersion: null, skippedVersion: event.version };
    case 'not-available':
      if (HOLDS_AN_UPDATE.has(status.phase)) return status;
      return { ...status, phase: 'idle', availableVersion: null, progress: null };
    case 'progress':
      if (status.phase !== 'downloading') return status;
      return { ...status, progress: Math.max(0, Math.min(100, Math.round(event.percent))) };
    case 'downloaded':
      return { ...status, phase: 'ready', availableVersion: event.version, progress: 100 };
    case 'install-requested':
      return { ...status, installRequested: true };
    case 'waiting':
      return { ...status, installRequested: true, waitingForRuns: true };
    case 'installing':
      return { ...status, phase: 'installing', waitingForRuns: false, error: null };
    case 'error':
      if (status.phase === 'ready' || status.phase === 'installing') {
        return {
          ...status,
          phase: 'ready',
          installRequested: false,
          waitingForRuns: false,
          error: event.message,
        };
      }
      return {
        ...status,
        phase: 'error',
        progress: null,
        installRequested: false,
        waitingForRuns: false,
        error: event.message,
      };
    default:
      return status;
  }
}

export function updaterChannel(channel: UpdateChannel): 'latest' | 'beta' {
  return channel === 'beta' ? 'beta' : 'latest';
}

export function parseChannel(value: unknown): UpdateChannel | null {
  return value === 'stable' || value === 'beta' ? value : null;
}

export function installDecision(status: UpdateStatus, activeRuns: number | null): InstallResult {
  if (status.phase !== 'ready') return { status: 'unavailable', reason: 'No update is ready yet.' };
  if (activeRuns === null || activeRuns > 0) return { status: 'waiting', reason: WAITING_FOR_RUNS };
  return { status: 'installing' };
}

export function isCheckFailure(detail: string | undefined): boolean {
  return detail?.startsWith('Cannot check for updates') ?? false;
}

const MISSING_CHANNEL = /Cannot find channel "(latest|beta)-mac\.yml"/;

const HTTP_STATUS = /\b(?:HttpError: |^)?(\d{3}) [A-Z][A-Za-z ]+/;
const OFFLINE =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_\w+|NETWORK_CHANGED|TIMED_OUT|ADDRESS_UNREACHABLE)/;
const MAX_DETAIL = 160;

function httpMessage(code: number): string | null {
  if (code === 401 || code === 403)
    return "The update server isn't accepting requests right now. Try again later.";
  if (code === 404) return "There's no release on the update feed yet. Check again later.";
  if (code >= 500) return 'The update server had a problem. Try again later.';
  return null;
}

export function updateErrorMessage(message: string): string {
  const missing = MISSING_CHANNEL.exec(message);
  if (missing) {
    const name = missing[1] === 'beta' ? 'Beta' : 'Stable';
    return `There's no ${name} release on the update feed yet. Check again later.`;
  }
  if (OFFLINE.test(message)) return "Couldn't reach the update server. Check your connection.";
  const status = HTTP_STATUS.exec(message);
  const friendly = status ? httpMessage(Number(status[1])) : null;
  if (friendly) return friendly;
  const firstLine =
    message
      .split('\n')[0]
      ?.replace(/<[^>]*>/g, '')
      .trim() ?? '';
  return firstLine.length > MAX_DETAIL ? `${firstLine.slice(0, MAX_DETAIL - 1)}…` : firstLine;
}
