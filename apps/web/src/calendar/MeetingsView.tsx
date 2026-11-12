import type { ReactNode } from 'react';
import { MeetingsTab } from '../meetings/index.ts';
import { DateTile } from './DateTile.tsx';

interface MeetingsViewProps {
  today: string;
  initialId: string | null;
  switcher: ReactNode;
  onStartChat: (text: string) => void;
}

export function MeetingsView({ today, initialId, switcher, onStartChat }: MeetingsViewProps) {
  return (
    <div className="td-card">
      <header className="td-head">
        <DateTile date={today} />
        <div>
          <h1 id="today-h">Meetings</h1>
          <p className="td-sub">Notes and transcripts from meetings you recorded</p>
        </div>
        {switcher}
      </header>
      <div className="td-meetings">
        <MeetingsTab
          initialId={initialId}
          onStartChat={(meeting, notes) => onStartChat(`Notes from ${meeting.title}\n\n${notes}`)}
        />
      </div>
    </div>
  );
}
