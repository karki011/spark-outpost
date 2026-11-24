import './new-event.css';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalendarStatus } from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import { ModalFrame } from '../ui/ModalFrame.tsx';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import { AllowGoogleChanges } from './EventReply.tsx';
import {
  defaultTimes,
  eventCalendars,
  eventSpan,
  parseGuests,
  type EventCalendar,
} from './new-event-model.ts';

interface NewEventDialogProps {
  status: CalendarStatus;
  date: string;
  today: string;
  now: number;
  onClose: () => void;
}

function createLabel(guests: number): string {
  if (guests === 0) return 'Create';
  return guests === 1 ? 'Create and invite 1 guest' : `Create and invite ${guests} guests`;
}

export function NewEventDialog({ status, date, today, now, onClose }: NewEventDialogProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const calendars = eventCalendars(status);
  const [calendarKey, setCalendarKey] = useState(calendars[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [times, setTimes] = useState(() => defaultTimes(date, today, now));
  const [guestText, setGuestText] = useState('');
  const [meet, setMeet] = useState(false);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const calendar: EventCalendar | undefined = calendars.find((item) => item.key === calendarKey);
  const span = eventSpan(times);
  const guests = parseGuests(guestText);
  const create = useMutation({
    mutationFn: () =>
      calendarApi.createEvent({
        calendarKey,
        title: title.trim(),
        start: span!.start,
        end: span!.end,
        guests: guests.emails,
        meet,
        location,
        notes,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: calendarKeys.all,
        predicate: (query) => query.queryKey[1] !== 'status',
      });
      onClose();
    },
  });
  const problem = !title.trim()
    ? 'Give the event a title.'
    : !span
      ? 'The end must be after the start.'
      : guests.problem;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!problem && calendar?.canEdit && !create.isPending) create.mutate();
  };
  const formId = `${ids}-form`;
  return (
    <ModalFrame
      className="ne-dialog"
      labelledBy={`${ids}-title`}
      busy={create.isPending}
      failure={create.error?.message ?? (tried ? problem : null)}
      footClassName="ne-foot"
      foot={
        <>
          <button type="button" className="btn line sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn primary sm"
            disabled={create.isPending || !calendar?.canEdit}
          >
            {create.isPending ? 'Creating…' : createLabel(guests.emails.length)}
          </button>
        </>
      }
      onClose={onClose}
    >
      <h2 id={`${ids}-title`}>New event</h2>
      <form id={formId} className="ne-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Title</label>
          <input
            id={`${ids}-name`}
            className="inp"
            data-autofocus
            value={title}
            maxLength={300}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="ne-when">
          <div className="field">
            <label htmlFor={`${ids}-date`}>Date</label>
            <input
              id={`${ids}-date`}
              className="inp"
              type="date"
              value={times.date}
              onChange={(event) => setTimes({ ...times, date: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-start`}>Starts</label>
            <input
              id={`${ids}-start`}
              className="inp"
              type="time"
              value={times.start}
              onChange={(event) => setTimes({ ...times, start: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-end`}>Ends</label>
            <input
              id={`${ids}-end`}
              className="inp"
              type="time"
              value={times.end}
              onChange={(event) => setTimes({ ...times, end: event.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <span aria-hidden="true">Calendar</span>
          <ChoicePicker
            label="Calendar"
            choices={calendars.map((item) => ({
              id: item.key,
              label: item.title === item.email ? item.email : `${item.title} (${item.email})`,
            }))}
            value={calendarKey}
            onChange={setCalendarKey}
          />
        </div>
        {calendar && !calendar.canEdit && (
          <AllowGoogleChanges
            accountId={calendar.accountId}
            flow={status.google.signIn}
            label="Allow changes"
            hint={`Google asks in your browser to let Spark change events for ${calendar.email}.`}
          />
        )}
        <div className="field">
          <span className="ne-label">
            <label htmlFor={`${ids}-guests`}>Guests</label>
            <InfoTip
              topic="guests"
              text="Email addresses, separated by commas. Google emails each guest an invitation. Leave empty to tell no one."
            />
          </span>
          <input
            id={`${ids}-guests`}
            className="inp"
            value={guestText}
            placeholder="ana@example.com, ivan@example.com"
            spellCheck={false}
            onChange={(event) => setGuestText(event.target.value)}
          />
        </div>
        <label className="ne-check">
          <input
            type="checkbox"
            checked={meet}
            onChange={(event) => setMeet(event.target.checked)}
          />
          Add a Google Meet link
        </label>
        <div className="field">
          <label htmlFor={`${ids}-where`}>Location</label>
          <input
            id={`${ids}-where`}
            className="inp"
            value={location}
            maxLength={500}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-notes`}>Description</label>
          <textarea
            id={`${ids}-notes`}
            className="inp"
            rows={3}
            value={notes}
            maxLength={5000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </form>
    </ModalFrame>
  );
}
