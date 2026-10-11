import './outpost-chat.css';
import type { ReactNode } from 'react';
import type { Run } from '@spark-outpost/contracts';
import { MemberFace } from '../../outposts/MemberFace.tsx';
import { ChevronIcon, OutpostIcon } from '../../ui/icons.tsx';

export type RunOutpost = NonNullable<Run['outpost']>;

type Sender = Pick<RunOutpost, 'fromUser' | 'fromHandle'> & {
  userStarted?: boolean;
  fromSpark?: boolean;
};

export function requestSender(outpost: Sender): string {
  if (outpost.fromUser) return 'From you';
  if (outpost.fromSpark) return 'From Spark';
  const kind = outpost.userStarted ? 'Task from' : 'From';
  return outpost.fromHandle ? `${kind} @${outpost.fromHandle}` : `${kind} another chat`;
}

export function requestNote(outpost: Sender): string | null {
  if (outpost.fromUser) return null;
  return outpost.userStarted ? 'started by you, not written by you' : 'not from you';
}

interface RequestHeaderProps {
  outpost: RunOutpost;
  fromChatId?: string | null | undefined;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}

export function RequestHeader({ outpost, fromChatId, onOpen, children }: RequestHeaderProps) {
  const note = requestNote(outpost);
  return (
    <div className="bubble from">
      <p className="from-head">
        {fromChatId && !outpost.fromUser && <MemberFace chatId={fromChatId} size="row" />}
        <b>{requestSender(outpost)}</b>
        {note && <span className="from-note">{note}</span>}
        <span className="from-where">
          <OutpostIcon />
          <span className="sr-only">in </span>
          {outpost.outpostName}
        </span>
        {onOpen && (
          <button type="button" className="from-open" onClick={onOpen}>
            Open in outpost
            <ChevronIcon />
          </button>
        )}
      </p>
      {children}
    </div>
  );
}
