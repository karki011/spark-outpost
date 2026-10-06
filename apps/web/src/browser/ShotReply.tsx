import { Fragment, type ReactNode } from 'react';
import type { BrowserShot } from '@spark-outpost/contracts';
import { BrowserShots } from './BrowserShots.tsx';
import { replyParts } from './shot-order.ts';

interface ShotReplyProps {
  text: string;
  shots: readonly BrowserShot[];
  children: (text: string, last: boolean) => ReactNode;
}

export function ShotReply({ text, shots, children }: ShotReplyProps) {
  const parts = replyParts(text, shots);
  return parts.map((part, index) =>
    part.kind === 'shots' ? (
      <BrowserShots key={part.key} shots={part.shots} />
    ) : (
      <Fragment key={part.key}>{children(part.text, index === parts.length - 1)}</Fragment>
    ),
  );
}
