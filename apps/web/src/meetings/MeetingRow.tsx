import type { MeetingListItem } from '@spark-outpost/contracts';
import { formatStarted, lengthLabel, NOTES_STATE_WORDS, sourceLabel } from './meeting-format.ts';

interface MeetingRowProps {
  item: MeetingListItem;
  selected: boolean;
  onOpen: (id: string) => void;
}

export function MeetingRow({ item, selected, onOpen }: MeetingRowProps) {
  const { meeting, snippets } = item;
  const recording = meeting.state === 'recording';
  return (
    <li>
      <button
        type="button"
        className="mt-row"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(meeting.id)}
      >
        <span className="mt-row-title">{meeting.title}</span>
        <span className="mt-row-state">
          {recording ? (
            <>
              <span className="mt-dot" aria-hidden="true" />
              Recording
            </>
          ) : (
            NOTES_STATE_WORDS[meeting.notesState]
          )}
        </span>
        <span className="mt-row-meta">
          {formatStarted(meeting.startedAt)} · {recording ? 'In progress' : lengthLabel(meeting)} ·{' '}
          {sourceLabel(meeting)}
        </span>
        {snippets.map((snippet, index) => (
          <span key={index} className="mt-snippet">
            {snippet}
          </span>
        ))}
      </button>
    </li>
  );
}
