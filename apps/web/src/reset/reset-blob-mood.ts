import type { HoldChange } from '../ui/HoldToConfirm.tsx';

export type HoldMood = 'worried' | 'panic' | 'scream';
export type ResetBlobMood = 'calm' | HoldMood | 'relieved' | 'away' | 'happy';
export type GraceBlobMood = 'plead' | 'bye';
export type BlobMood = ResetBlobMood | GraceBlobMood;

export type ResetBlobEvent = HoldChange | { phase: 'undone' } | { phase: 'settled' };

export const SETTLE_MS = 1800;

export const BUBBLES: Partial<Record<BlobMood, string>> = {
  panic: 'Wait—',
  scream: 'AAAH!',
  relieved: 'Phew.',
  happy: 'Yay!',
};

export function moodForProgress(progress: number): HoldMood {
  if (progress < 0.3) return 'worried';
  if (progress < 0.7) return 'panic';
  return 'scream';
}

export function nextResetBlobMood(mood: ResetBlobMood, event: ResetBlobEvent): ResetBlobMood {
  switch (event.phase) {
    case 'holding':
      return moodForProgress(event.progress);
    case 'released':
      return 'relieved';
    case 'done':
      return 'away';
    case 'undone':
      return 'happy';
    case 'settled':
      return 'calm';
    case 'idle':
      return mood;
  }
}

export function settles(mood: ResetBlobMood): boolean {
  return mood === 'relieved' || mood === 'happy';
}

export function graceBlobMood(secondsLeft: number): GraceBlobMood {
  return secondsLeft <= 1 ? 'bye' : 'plead';
}
