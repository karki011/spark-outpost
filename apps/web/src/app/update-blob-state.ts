import type { UpdateStatus } from '@spark-outpost/contracts';
import { WAITING_FOR_RUNS } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';

export type BlobStep = 'available' | 'downloading' | 'ready' | 'waiting' | 'installing' | 'updated';

export interface UpdateBlobView {
  step: BlobStep;
  label: string;
  description: string;
  mood: ScoutMood;
  fill: number | null;
}

export const AVAILABLE_TIP = 'Update ready to download · click to get it';
export const READY_TIP = 'Restart to update';
const REDUCED_FILL_STEP = 25;

export function previewUpdatedText(version: string): string {
  return `Updated to ${version} (preview)`;
}

export function downloadPercent(status: UpdateStatus | null): number | null {
  if (status?.phase !== 'downloading' || !status.installRequested) return null;
  return status.progress ?? 0;
}

export function shownFill(fill: number | null, reducedMotion: boolean): number | null {
  if (fill === null || !reducedMotion) return fill;
  return Math.floor(fill / REDUCED_FILL_STEP) * REDUCED_FILL_STEP;
}

function updatedView(status: UpdateStatus | null, celebrating: boolean): UpdateBlobView | null {
  if (!celebrating || !status?.previewUpdatedTo) return null;
  return {
    step: 'updated',
    label: 'Updated',
    description: previewUpdatedText(status.previewUpdatedTo),
    mood: 'happy',
    fill: null,
  };
}

export function updateBlobView(
  status: UpdateStatus | null,
  celebrating = false,
): UpdateBlobView | null {
  if (!status || !status.availableVersion) return updatedView(status, celebrating);
  const version = `Spark Outpost ${status.availableVersion}`;
  if (status.phase === 'installing') {
    return {
      step: 'installing',
      label: 'Installing…',
      description: `Installing ${version} and restarting`,
      mood: 'working',
      fill: null,
    };
  }
  const percent = downloadPercent(status);
  if (percent !== null) {
    return {
      step: 'downloading',
      label: `${percent}%`,
      description: `Getting ${version}: ${percent}%`,
      mood: 'alert',
      fill: percent,
    };
  }
  if (status.phase === 'available') {
    return {
      step: 'available',
      label: 'Update',
      description: `${AVAILABLE_TIP} (${version})`,
      mood: null,
      fill: 0,
    };
  }
  if (status.phase !== 'ready') return updatedView(status, celebrating);
  if (status.waitingForRuns) {
    return {
      step: 'waiting',
      label: 'Waiting',
      description: `${WAITING_FOR_RUNS} (${version})`,
      mood: 'sleep',
      fill: null,
    };
  }
  return {
    step: 'ready',
    label: 'Restart',
    description: `${READY_TIP} (${version})`,
    mood: 'happy',
    fill: null,
  };
}
