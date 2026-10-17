import { useEffect, useId, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { useKeepInViewport } from '../ui/viewport-clamp.ts';
import { ClashTag } from './ClashTag.tsx';
import { notesSnippet, peopleLine } from './event-text.ts';
import { EventActions, EventMeta } from './EventPanel.tsx';
import { useEventDetail, localDate } from './use-calendar.ts';

const GAP = 10;
const WIDTH = 340;

interface EventPopoverProps {
  event: CalendarEvent;
  anchor: HTMLElement;
  calendars: ReadonlyMap<string, CalendarChoice>;
  clashes: readonly string[] | undefined;
  today: string;
  now: number;
  onStartChat: (text: string) => void;
  onClose: () => void;
}

function placeBeside(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const right = rect.right + GAP;
  const left = right + WIDTH <= window.innerWidth ? right : rect.left - GAP - WIDTH;
  return { left: Math.max(GAP, left), top: Math.max(GAP, rect.top - GAP) };
}

function useDismiss(
  panel: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
  onClose: () => void,
) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
      if (anchor.isConnected) anchor.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [panel, anchor, onClose]);
}

export function EventPopover(props: EventPopoverProps) {
  const { event, anchor, onClose } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const place = useMemo(() => placeBeside(anchor), [anchor]);
  const detail = useEventDetail(event);
  useKeepInViewport(panelRef, true);
  useDismiss(panelRef, anchor, onClose);
  useEffect(() => {
    panelRef.current?.focus();
  }, [event.key]);
  const date = localDate(Date.parse(event.start));
  const notes = detail.data ? notesSnippet(detail.data.notes) : '';
  const people = peopleLine(detail.data?.attendees ?? [], event.attendeeCount);
  const close = () => {
    onClose();
    if (anchor.isConnected) anchor.focus();
  };
  return (
    <div
      ref={panelRef}
      className="mo-pop"
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      style={place}
    >
      <div className="mo-pop-head">
        <h2 id={headingId}>{event.title}</h2>
        <button type="button" className="mo-step" aria-label="Close" onClick={close}>
          <XIcon />
        </button>
      </div>
      <EventMeta event={event} date={date} calendars={props.calendars} />
      {props.clashes && (
        <p className="td-panel-clash">
          <ClashTag titles={props.clashes} />
        </p>
      )}
      {notes && <p className="mo-pop-notes">{notes}</p>}
      {people && <p className="mo-pop-people">{people}</p>}
      <EventActions
        event={event}
        isToday={date === props.today}
        now={props.now}
        onStartChat={props.onStartChat}
      />
    </div>
  );
}
