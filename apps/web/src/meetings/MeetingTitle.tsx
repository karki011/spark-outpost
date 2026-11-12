import { useEffect, useRef, useState } from 'react';
import { MEETING_TITLE_MAX, type Meeting } from '@spark-outpost/contracts';
import { usePatchMeeting } from './use-meetings.ts';

export function MeetingTitle({ meeting }: { meeting: Meeting }) {
  const patch = usePatchMeeting(meeting.id);
  const [title, setTitle] = useState(meeting.title);
  const editing = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing.current) setTitle(meeting.title);
  }, [meeting.title]);

  function commit() {
    editing.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = title.trim();
    if (!next) {
      setTitle(meeting.title);
      return;
    }
    if (next !== meeting.title) patch.mutate({ title: next });
  }

  return (
    <input
      className="mt-title"
      aria-label="Meeting title"
      maxLength={MEETING_TITLE_MAX}
      value={title}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          setTitle(meeting.title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
