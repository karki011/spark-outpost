import type { ScoutMood } from '../brand/BlobScout.tsx';
import { CODE_LENGTH } from './lock-code.ts';

export type LockPose = 'asleep' | 'awake' | 'expectant' | 'no' | 'sulk' | 'happy';

export interface LockMoment {
  opened: boolean;
  refusing: boolean;
  waiting: boolean;
  asking: boolean;
  digits: number;
}

const MOODS: Record<LockPose, ScoutMood> = {
  asleep: 'sleep',
  awake: null,
  expectant: 'alert',
  no: 'sad',
  sulk: 'sad',
  happy: 'happy',
};

const LOOK_REACH = 2.4;

export function lockPose(moment: LockMoment): LockPose {
  if (moment.opened) return 'happy';
  if (moment.refusing) return 'no';
  if (moment.waiting) return 'sulk';
  if (moment.asking) return 'expectant';
  if (moment.digits > 0) return 'awake';
  return 'asleep';
}

export function poseMood(pose: LockPose): ScoutMood {
  return MOODS[pose];
}

export function lookOffset(digits: number): number {
  const typed = Math.max(1, Math.min(CODE_LENGTH, digits));
  const along = (typed - 1) / (CODE_LENGTH - 1);
  return Number(((along * 2 - 1) * LOOK_REACH).toFixed(2));
}
