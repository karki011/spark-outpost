import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { ScoutMood } from './BlobScout.tsx';
import type { BlobExpression } from './blob-expression.ts';

const MOOD_EXPRESSIONS: Record<NonNullable<ScoutMood>, BlobExpression> = {
  working: 'thinking',
  alert: 'unsure',
  happy: 'happy',
  sad: 'sad',
  sleep: 'sleepy',
};

export function userBlobSeed(displayName: string): string {
  const trimmed = displayName.trim().toLowerCase();
  return `user:${trimmed || 'guest'}`;
}

export function userBlobExpression(mood: ScoutMood): BlobExpression {
  return mood ? MOOD_EXPRESSIONS[mood] : 'idle';
}

interface UserBlobProps {
  displayName: string;
  size?: number;
  mood?: ScoutMood;
}

export function UserBlob({ displayName, size = 44, mood = null }: UserBlobProps) {
  return (
    <Blobatar
      name={userBlobSeed(displayName)}
      size={size}
      animate="always"
      expression={expressions[userBlobExpression(mood)]}
      aria-hidden="true"
    />
  );
}
