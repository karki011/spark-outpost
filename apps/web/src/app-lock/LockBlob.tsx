import './lock-blob.css';
import type { CSSProperties } from 'react';
import { BlobScout } from '../brand/BlobScout.tsx';
import { LockIcon, UnlockIcon } from '../ui/icons.tsx';
import { lockPose, lookOffset, poseMood, type LockMoment } from './lock-pose.ts';

const SIZE = 128;

export function LockBlob({ moment, misses }: { moment: LockMoment; misses: number }) {
  const pose = lockPose(moment);
  const style = { '--lock-look': `${lookOffset(moment.digits)}px` } as CSSProperties;
  return (
    <span
      className="lock-blob"
      data-pose={pose}
      data-beat={moment.digits % 2 === 0 ? 'even' : 'odd'}
      data-miss={misses % 2 === 0 ? 'even' : 'odd'}
      style={style}
      aria-hidden="true"
    >
      <span className="lock-blob-turn">
        <span className="lock-blob-hop">
          <BlobScout size={SIZE} mood={poseMood(pose)} />
        </span>
        <span className="lock-blob-tag">{pose === 'happy' ? <UnlockIcon /> : <LockIcon />}</span>
      </span>
    </span>
  );
}
