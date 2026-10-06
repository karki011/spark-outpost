import { Fragment, type ReactNode } from 'react';
import type { BrowserShot } from '@spark-outpost/contracts';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import type { CommandView } from './command-model.ts';
import { CommandTerminal } from './CommandTerminal.tsx';
import { turnParts } from './reply-parts.ts';

interface TurnReplyProps {
  text: string;
  shots: readonly BrowserShot[];
  commands: readonly CommandView[];
  waiting?: boolean;
  children: (text: string, last: boolean) => ReactNode;
}

export function TurnReply({ text, shots, commands, waiting = false, children }: TurnReplyProps) {
  const parts = turnParts(text, shots, commands);
  return parts.map((part, index) => {
    if (part.kind === 'shots') return <BrowserShots key={part.key} shots={part.shots} />;
    if (part.kind === 'command') {
      return <CommandTerminal key={part.key} command={part.command} waiting={waiting} />;
    }
    return <Fragment key={part.key}>{children(part.text, index === parts.length - 1)}</Fragment>;
  });
}
