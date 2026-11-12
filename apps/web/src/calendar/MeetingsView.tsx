import { memo, useCallback } from 'react';
import type { Meeting } from '@spark-outpost/contracts';
import { MeetingsTab } from '../meetings/index.ts';

interface MeetingsViewProps {
  openId: string | null;
  onOpen: (id: string | null) => void;
  onStartChat: (text: string) => void;
}

export const MeetingsView = memo(function MeetingsView({
  openId,
  onOpen,
  onStartChat,
}: MeetingsViewProps) {
  const startChat = useCallback(
    (meeting: Meeting, notes: string) => onStartChat(`Notes from ${meeting.title}\n\n${notes}`),
    [onStartChat],
  );
  return (
    <div className="td-card td-meetings">
      <h1 className="sr-only">Transcripts</h1>
      <MeetingsTab openId={openId} onOpen={onOpen} onStartChat={startChat} />
    </div>
  );
});
