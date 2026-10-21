import type { CalendarEvent, ConversationSummary } from '@spark-outpost/contracts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { openJoin } from '../calendar/today-model.ts';
import { attentionLine } from '../conversations/row-state.ts';
import { minutesAhead } from './home-model.ts';
import { answerable } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { useArmed } from './island-parts.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { findOption, useDecide, type Decided } from './use-decide.ts';

const BLOBS_SHOWN = 3;

export interface StripData {
  count: number;
  meeting: CalendarEvent | null;
  working: readonly ConversationSummary[];
  top: Card | null;
}

export function stripShows(strip: StripData, calendarLine: boolean): boolean {
  if (strip.count > 0 || strip.working.length > 0) return true;
  return strip.meeting !== null && !calendarLine;
}

interface RestStripProps {
  strip: StripData;
  hover: boolean;
  calendar: IslandCalendar;
  onOpen: () => void;
  onDecided: (card: Card, decided: Decided) => void;
}

function HoverRequest({
  card,
  onDecided,
  onOpen,
}: { card: Card } & Pick<RestStripProps, 'onDecided' | 'onOpen'>) {
  const approval = card.approval;
  const decide = useDecide(approval, (decided) => onDecided(card, decided), 'The agent');
  const allow = approval ? findOption(approval, 'allow_once') : undefined;
  const deny = approval
    ? (findOption(approval, 'reject_once') ?? findOption(approval, 'reject_always'))
    : undefined;
  const quick = answerable(card) && allow && deny ? { allow, deny } : null;
  const armed = useArmed(approval?.id ?? card.chat.id);
  const ready = armed && !decide.isPending;
  return (
    <div className="isl-hover" data-in-place>
      <SessionBlob chat={card.chat} state="waiting" size={26} />
      <button type="button" className="isl-hover-text" onClick={onOpen}>
        <b>{card.chat.title}</b>
        <span>{attentionLine(card.chat.attention)}</span>
      </button>
      {quick ? (
        <>
          <button
            type="button"
            className="isl-btn primary"
            data-arming={!armed || undefined}
            disabled={!ready}
            onClick={() => decide.mutate({ option: quick.allow, scope: 'once' })}
          >
            Allow
          </button>
          <button
            type="button"
            className="isl-btn deny"
            data-arming={!armed || undefined}
            disabled={!ready}
            onClick={() => decide.mutate({ option: quick.deny, scope: 'once' })}
          >
            Deny
          </button>
        </>
      ) : (
        <button type="button" className="isl-btn primary" onClick={onOpen}>
          Review
        </button>
      )}
    </div>
  );
}

function HoverMeeting({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const link = event.link;
  return (
    <div className="isl-hover" data-in-place>
      <span className="isl-hover-text">
        <b>
          {event.title} in {minutesAhead(event, calendar.at)} min
        </b>
        <span>{calendar.calendarName(event)}</span>
      </span>
      {link && (
        <button
          type="button"
          className="isl-btn primary"
          onClick={() => {
            openJoin(link.url);
            calendar.onJoined(event.key);
          }}
        >
          Join
        </button>
      )}
      <button type="button" className="isl-btn" onClick={() => calendar.onSnooze(event)}>
        Snooze
      </button>
    </div>
  );
}

export function RestStrip({ strip, hover, calendar, onOpen, onDecided }: RestStripProps) {
  if (hover && strip.top) {
    return <HoverRequest card={strip.top} onDecided={onDecided} onOpen={onOpen} />;
  }
  if (hover && strip.meeting) return <HoverMeeting event={strip.meeting} calendar={calendar} />;
  const more = strip.working.length - BLOBS_SHOWN;
  return (
    <button type="button" className="isl-strip" aria-label="Open Spark Island" onClick={onOpen}>
      {strip.count > 0 && (
        <span className="isl-strip-count" aria-label={`${strip.count} need you`}>
          {strip.count}
        </span>
      )}
      {strip.meeting && (
        <span className="isl-strip-part isl-strip-meet">
          {strip.meeting.title} <b>{minutesAhead(strip.meeting, calendar.at)}m</b>
        </span>
      )}
      {strip.working.length > 0 && (
        <span
          className="isl-strip-part isl-strip-work"
          aria-label={`${strip.working.length} working`}
        >
          {strip.working.slice(0, BLOBS_SHOWN).map((chat) => (
            <SessionBlob key={chat.id} chat={chat} state="working" size={18} />
          ))}
          <span>{more > 0 ? `+${more}` : strip.working.length}</span>
        </span>
      )}
    </button>
  );
}
