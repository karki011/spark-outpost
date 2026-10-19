import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  clashText,
  JOIN_LEAD_MS,
  joinOpen,
  spanOf,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { clock } from '../calendar/calendar-format.ts';
import {
  agendaPreview,
  joinLabel,
  peopleRow,
  placeRow,
  startsLabel,
  timeRow,
} from '../calendar/meeting-card.ts';
import { openJoin } from '../calendar/today-model.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { useEventDetail } from '../calendar/use-calendar.ts';
import { ClockIcon, PeopleIcon, VideoIcon, WarnIcon, XIcon } from '../ui/icons.tsx';
import { useLeave } from './use-leave.ts';

interface CalendarBubbleProps {
  event: CalendarEvent;
  top: number;
  calendar: IslandCalendar;
  compact: boolean;
}

function Row({ icon, tone, children }: { icon: ReactNode; tone?: 'warn'; children: ReactNode }) {
  return (
    <li className="isl-meet-row" data-tone={tone}>
      <span className="isl-meet-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="isl-meet-text">{children}</span>
    </li>
  );
}

function JoinAction({ event, at }: { event: CalendarEvent; at: number }) {
  const link = event.link;
  if (!link) return null;
  const { start, end } = spanOf(event);
  if (joinOpen({ start, end }, at)) {
    return (
      <button
        type="button"
        className="isl-calline-act primary"
        aria-label={`${joinLabel(event)}: ${event.title}`}
        onClick={() => openJoin(link.url)}
      >
        {joinLabel(event)}
      </button>
    );
  }
  if (at >= end) return null;
  return <span className="isl-meet-later">Join opens at {clock(start - JOIN_LEAD_MS)}</span>;
}

export function CalendarBubble({ event, top, calendar, compact }: CalendarBubbleProps) {
  const { leaving, leave } = useLeave();
  const detail = useEventDetail(event, true).data;
  const place = placeRow(event, calendar.calendarName(event), detail?.location ?? null);
  const people = peopleRow(detail?.attendees ?? []);
  const clash = clashText(calendar.clashes.get(event.key) ?? []);
  const agenda = detail ? agendaPreview(detail.snippet || detail.agenda) : null;
  const dismiss = () => leave(() => calendar.onDismissNudge(event));
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key !== 'Escape') return;
    key.preventDefault();
    key.stopPropagation();
    dismiss();
  };
  return (
    <div
      className="isl-restline isl-meet"
      data-compact={compact || undefined}
      data-leaving={leaving || undefined}
      role="group"
      aria-label={`Meeting ${event.title}`}
      style={{ '--line-top': `${top}px` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="isl-meet-x"
        title="Dismiss"
        aria-label={`Dismiss the nudge for ${event.title}`}
        onClick={dismiss}
      >
        <XIcon />
      </button>
      <p className="isl-meet-when">{startsLabel(event, calendar.at)}</p>
      <p className="isl-meet-title" title={event.title}>
        {event.title}
      </p>
      {compact ? (
        <p className="isl-meet-sub">{[timeRow(event), place].filter(Boolean).join(' · ')}</p>
      ) : (
        <ul className="isl-meet-rows">
          <Row icon={<ClockIcon />}>{timeRow(event)}</Row>
          {place && <Row icon={<VideoIcon />}>{place}</Row>}
          {people && <Row icon={<PeopleIcon />}>{people}</Row>}
          {clash && (
            <Row icon={<WarnIcon />} tone="warn">
              {clash}
            </Row>
          )}
        </ul>
      )}
      {!compact && agenda && <p className="isl-meet-agenda">{agenda}</p>}
      <div className="isl-meet-acts">
        <JoinAction event={event} at={calendar.at} />
        <button
          type="button"
          className="isl-calline-act"
          onClick={() => leave(() => calendar.onSnooze(event))}
        >
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
