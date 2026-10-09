import './outpost-chat.css';
import type { ReactNode } from 'react';
import type { Run } from '@spark-outpost/contracts';
import { ChatFace } from '../../brand/ChatFace.tsx';
import { ChevronIcon, OutpostIcon } from '../../ui/icons.tsx';

export type RunOutpost = NonNullable<Run['outpost']>;

export function requestSender(outpost: Pick<RunOutpost, 'fromUser' | 'fromHandle'>): string {
  if (outpost.fromUser) return 'From you';
  return outpost.fromHandle ? `From @${outpost.fromHandle}` : 'From another chat';
}

interface RequestHeaderProps {
  outpost: RunOutpost;
  fromChatId?: string | null | undefined;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}

export function RequestHeader({ outpost, fromChatId, onOpen, children }: RequestHeaderProps) {
  return (
    <div className="bubble from">
      <p className="from-head">
        {fromChatId && !outpost.fromUser && <ChatFace chatId={fromChatId} size="row" />}
        <b>{requestSender(outpost)}</b>
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
