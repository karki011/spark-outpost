export type UpdateChannel = 'stable' | 'beta';

export type UpdatePhase = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export type UpdatesOffReason = 'dev' | 'unconfigured';

export interface UpdateStatus {
  currentVersion: string;
  channel: UpdateChannel;
  phase: UpdatePhase;
  offReason: UpdatesOffReason | null;
  availableVersion: string | null;
  progress: number | null;
  lastCheckedAt: string | null;
  error: string | null;
  skippedVersion: string | null;
  releaseNotesUrl: string | null;
}

export type InstallResult = { started: true } | { started: false; reason: string };
