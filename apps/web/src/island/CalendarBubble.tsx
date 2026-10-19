import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import { CALENDAR_SERVICE_NAMES, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { minutesUntil, span } from '../calendar/calendar-format.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { JoinButton } from '../calendar/JoinButton.tsx';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { useEventDetail } from '../calendar/use-calendar.ts';
import { XIcon } from '../ui/icons.tsx';

const PEOPLE_SHOWN = 2;

interface CalendarBubbleProps {
  event: CalendarEvent;
  top: number;
  calendar: IslandCalendar;
}

function startsLabel(event: CalendarEvent, at: number): string {
  const minutes = minutesUntil(spanOf(event).start, at);
  return minutes === 0 ? 'Now' : `In ${minutes} min`;
}

function peopleText(names: readonly string[]): string {
  const shown = names.slice(0, PEOPLE_SHOWN).join(', ');
  const rest = names.length - PEOPLE_SHOWN;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}

function BubbleMore({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const detail = useEventDetail(event, true).data;
  const { start, end } = spanOf(event);
  const names = (detail?.attendees ?? []).map((person) => person.name);
  const agenda = detail?.snippet ?? '';
  return (
    <div className="isl-bubble-more">
      <p className="isl-bubble-meta">
        {span(start, end)} · {calendar.calendarName(event)}
      </p>
      {names.length > 0 && <p className="isl-bubble-people">{peopleText(names)}</p>}
      <ClashTag titles={calendar.clashes.get(event.key)} />
      {agenda && <p className="isl-bubble-agenda">{agenda}</p>}
      <div className="isl-bubble-acts">
        <button type="button" className="isl-calline-act" onClick={() => calendar.onSnooze(event)}>
          Snooze 2 min
        </button>
        <button
          type="button"
          className="isl-calline-act"
          onClick={() => calendar.onOpenEvent(event.key)}
        >
          Open
        </button>
      </div>
    </div>
  );
}

export function CalendarBubble({ event, top, calendar }: CalendarBubbleProps) {
  const [open, setOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const { start, end } = spanOf(event);
  const service = event.link ? CALENDAR_SERVICE_NAMES[event.link.service] : null;
  const onBlur = (blur: FocusEvent) => {
    if (!bubbleRef.current?.contains(blur.relatedTarget as Node | null)) setOpen(false);
  };
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key !== 'Escape') return;
    key.preventDefault();
    key.stopPropagation();
    calendar.onDismissNudge(event);
  };
  return (
    <div
      ref={bubbleRef}
      className="isl-restline isl-bubble"
      data-open={open || undefined}
      role="group"
      aria-label={`Meeting ${event.title}`}
      style={{ '--line-top': `${top}px` } as CSSProperties}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => {
        if (!bubbleRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <div className="isl-bubble-row">
        <span className="isl-bubble-when">{startsLabel(event, calendar.at)}</span>
        <span className="isl-bubble-title" title={event.title}>
          · {event.title}
        </span>
        <JoinButton event={event} now={calendar.at} className="isl-calline-act primary" plain />
        <button
          type="button"
          className="isl-bubble-x"
          title="Dismiss"
          aria-label={`Dismiss the nudge for ${event.title}`}
          onClick={() => calendar.onDismissNudge(event)}
        >
          <XIcon />
        </button>
      </div>
      {open ? (
        <BubbleMore event={event} calendar={calendar} />
      ) : (
        <p className="isl-bubble-meta">
          {span(start, end)}
          {service ? ` · ${service}` : ''}
        </p>
      )}
    </div>
  );
}
