import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { BlobExpression } from './blob-expression.ts';

export function userBlobSeed(displayName: string): string {
  const trimmed = displayName.trim().toLowerCase();
  return `user:${trimmed || 'guest'}`;
}

interface UserBlobProps {
  displayName: string;
  size?: number;
  expression?: BlobExpression;
  animate?: 'always' | 'hover';
}

export function UserBlob({
  displayName,
  size = 44,
  expression = 'idle',
  animate = 'hover',
}: UserBlobProps) {
  return (
    <Blobatar
      name={userBlobSeed(displayName)}
      size={size}
      animate={animate}
      expression={expressions[expression]}
      aria-hidden="true"
    />
  );
}
