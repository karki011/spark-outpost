import type { UpdateStatus } from '@spark-outpost/contracts';
import { WAITING_FOR_RUNS } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';

export type BlobStep = 'ready' | 'downloading' | 'waiting' | 'installing';

export interface UpdateBlobView {
  step: BlobStep;
  label: string;
  description: string;
  mood: ScoutMood;
  progress: number | null;
}

export const READY_TIP = 'New update ready — click to get the latest';

export function updateBlobView(status: UpdateStatus | null): UpdateBlobView | null {
  if (!status || !status.availableVersion) return null;
  const version = `Spark Outpost ${status.availableVersion}`;
  if (status.phase === 'installing') {
    return {
      step: 'installing',
      label: 'Restarting',
      description: `Installing ${version} and restarting`,
      mood: 'working',
      progress: null,
    };
  }
  if (status.phase === 'downloading' && status.installRequested) {
    const progress = status.progress ?? 0;
    return {
      step: 'downloading',
      label: `${progress}%`,
      description: `Getting ${version}: ${progress}%`,
      mood: 'working',
      progress,
    };
  }
  if (status.phase !== 'ready' && status.phase !== 'available') return null;
  if (status.waitingForRuns) {
    return {
      step: 'waiting',
      label: 'Waiting',
      description: `${WAITING_FOR_RUNS} (${version})`,
      mood: 'sleep',
      progress: null,
    };
  }
  return {
    step: 'ready',
    label: 'Update',
    description: `${READY_TIP} (${version})`,
    mood: null,
    progress: null,
  };
}
