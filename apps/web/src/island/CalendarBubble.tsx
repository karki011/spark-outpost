import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { clashText, joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
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
import { countdownSeconds } from '../calendar/alert/alert-model.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { useEventDetail } from '../calendar/use-calendar.ts';
import { ClockIcon, PeopleIcon, VideoIcon, WarnIcon } from '../ui/icons.tsx';
import { CardButton, MeetingCardBody, type MeetingCardRow } from '../calendar/card/MeetingCard.tsx';
import { cardLead } from '../calendar/card/card-lead.ts';
import { JoinAtStartButton } from '../calendar/JoinAtStartButton.tsx';
import { useLeave } from './use-leave.ts';

interface CalendarBubbleProps {
  event: CalendarEvent;
  top: number;
  calendar: IslandCalendar;
  compact: boolean;
}

function JoinAction({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const at = calendar.at;
  const link = event.link;
  if (!link) return null;
  const { start, end } = spanOf(event);
  if (joinOpen({ start, end }, at, calendar.joinLeadMs)) {
    return (
      <CardButton
        primary
        label={joinLabel(event)}
        ariaLabel={`${joinLabel(event)}: ${event.title}`}
        onClick={() => {
          openJoin(link.url);
          calendar.onJoined(event.key);
        }}
      />
    );
  }
  if (at >= end) return null;
  return <span className="mc-later">Join opens at {clock(start - calendar.joinLeadMs)}</span>;
}

function AutoJoin({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const countdown = calendar.countdown;
  const [now, setNow] = useState(Date.now);
  const active = countdown?.eventKey === event.key;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active || !countdown) return null;
  return (
    <div className="mc-status" role="status">
      <span>Joining in {countdownSeconds(countdown.deadline, now)} s</span>
      <CardButton label="Cancel" onClick={calendar.onCancelJoin} />
      <CardButton primary label="Join now" onClick={calendar.onJoinNow} />
    </div>
  );
}

function LeadAction({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const lead = cardLead(event, calendar.at);
  if (lead === 'join') return <JoinAction event={event} calendar={calendar} />;
  if (lead === 'planned') {
    return (
      <CardButton
        label="Don't open"
        ariaLabel={`Don't open ${event.title} at the start`}
        onClick={() => calendar.onCancelJoinAtStart(event)}
      />
    );
  }
  return (
    <JoinAtStartButton
      title={event.title}
      className="mc-btn primary"
      autoJoin={calendar.autoJoin}
      onAsk={() => calendar.onJoinAtStart(event)}
    />
  );
}

export function CalendarBubble({ event, top, calendar, compact }: CalendarBubbleProps) {
  const { leaving, leave } = useLeave();
  const detail = useEventDetail(event, true).data;
  const place = placeRow(event, calendar.calendarName(event), detail?.location ?? null);
  const people = peopleRow(detail?.attendees ?? []);
  const clash = clashText(calendar.clashes.get(event.key) ?? []);
  const agenda = detail ? agendaPreview(detail.snippet || detail.agenda) : null;
  const beforeStart = calendar.at < spanOf(event).start;
  const lead = cardLead(event, calendar.at);
  const rows: MeetingCardRow[] = compact
    ? [{ key: 'time', text: [timeRow(event), place].filter(Boolean).join(' · ') }]
    : [
        { key: 'time', icon: <ClockIcon />, text: timeRow(event) },
        ...(place ? [{ key: 'place', icon: <VideoIcon />, text: place }] : []),
        ...(people ? [{ key: 'people', icon: <PeopleIcon />, text: people }] : []),
        ...(clash
          ? [{ key: 'clash', icon: <WarnIcon />, text: clash, tone: 'warn' as const }]
          : []),
      ];
  const dismiss = () => leave(() => calendar.onDismissNudge(event));
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key !== 'Escape') return;
    key.preventDefault();
    key.stopPropagation();
    dismiss();
  };
  return (
    <div
      className="isl-restline isl-meet mc"
      data-compact={compact || undefined}
      data-leaving={leaving || undefined}
      role="group"
      aria-label={`Meeting ${event.title}`}
      style={{ '--line-top': `${top}px` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <MeetingCardBody
        kicker={startsLabel(event, calendar.at)}
        title={event.title}
        compact={compact}
        rows={rows}
        agenda={agenda}
        status={
          <>
            {lead === 'planned' && (
              <p className="mc-status">Opens 20 s before {clock(spanOf(event).start)}</p>
            )}
            <AutoJoin event={event} calendar={calendar} />
          </>
        }
        more={[
          ...(lead !== 'join' &&
          event.link &&
          joinOpen(spanOf(event), calendar.at, calendar.joinLeadMs)
            ? [
                {
                  label: `${joinLabel(event)} now`,
                  onAct: () => {
                    openJoin(event.link!.url);
                    calendar.onJoined(event.key);
                  },
                },
              ]
            : []),
          {
            label: 'Open in Today',
            onAct: () =>
              leave(() => {
                calendar.onDismissNudge(event);
                calendar.onOpenEvent(event.key);
              }),
          },
        ]}
        closeLabel={`Dismiss the nudge for ${event.title}`}
        onClose={dismiss}
      >
        <LeadAction event={event} calendar={calendar} />
        <CardButton
          label={beforeStart ? 'Snooze until start' : 'Snooze 1 min'}
          onClick={() =>
            leave(() =>
              beforeStart ? calendar.onSnooze(event, true) : calendar.onSnoozeAlert(event),
            )
          }
        />
      </MeetingCardBody>
    </div>
  );
}
