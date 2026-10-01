export type UpdateChannel = 'stable' | 'beta';

export type UpdatePhase =
  'off' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export type UpdatesOffReason = 'dev' | 'unconfigured';

export interface UpdateStatus {
  currentVersion: string;
  channel: UpdateChannel;
  autoDownload: boolean;
  phase: UpdatePhase;
  offReason: UpdatesOffReason | null;
  availableVersion: string | null;
  progress: number | null;
  installRequested: boolean;
  waitingForRuns: boolean;
  lastCheckedAt: string | null;
  error: string | null;
  skippedVersion: string | null;
  releaseNotesUrl: string | null;
}

export type InstallResult =
  | { status: 'installing' }
  | { status: 'downloading' }
  | { status: 'waiting'; reason: string }
  | { status: 'unavailable'; reason: string };

export const WAITING_FOR_RUNS = 'Spark will update when your work finishes.';

export function isBetaVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version);
}

export function defaultUpdateChannel(version: string): UpdateChannel {
  return isBetaVersion(version) ? 'beta' : 'stable';
}
