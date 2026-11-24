import { useState } from 'react';
import { NewEventDialog } from './NewEventDialog.tsx';
import { eventCalendars } from './new-event-model.ts';
import { useCalendarStatus } from './use-calendar.ts';

interface NewEventButtonProps {
  date: string;
  today: string;
  now: number;
}

export function NewEventButton(props: NewEventButtonProps) {
  const status = useCalendarStatus();
  const [open, setOpen] = useState(false);
  if (!status.data || eventCalendars(status.data).length === 0) return null;
  return (
    <>
      <button type="button" className="btn line sm" onClick={() => setOpen(true)}>
        New event
      </button>
      {open && <NewEventDialog status={status.data} {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
