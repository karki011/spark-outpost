import { MeetingsTab } from '../meetings/index.ts';

interface MeetingsViewProps {
  initialId: string | null;
  onStartChat: (text: string) => void;
}

export function MeetingsView({ initialId, onStartChat }: MeetingsViewProps) {
  return (
    <div className="td-card td-meetings">
      <h1 id="today-h" className="sr-only">
        Transcripts
      </h1>
      <MeetingsTab
        initialId={initialId}
        onStartChat={(meeting, notes) => onStartChat(`Notes from ${meeting.title}\n\n${notes}`)}
      />
    </div>
  );
}
