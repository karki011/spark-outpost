import { useEffect, useId, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { useDismiss } from '../ui/use-dismiss.ts';
import { clampStart, useKeepInViewport } from '../ui/viewport-clamp.ts';
import { ClashTag } from './ClashTag.tsx';
import { EventInfo } from './EventDetails.tsx';
import { EventActions, EventMeta } from './EventPanel.tsx';
import { localDate } from './use-calendar.ts';

const GAP = 10;
const WIDTH = 340;
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

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
  return {
    left: clampStart(left, WIDTH, window.innerWidth, GAP),
    top: Math.max(GAP, rect.top - GAP),
  };
}

export function EventPopover(props: EventPopoverProps) {
  const { event, anchor, onClose } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const place = useMemo(() => placeBeside(anchor), [anchor]);
  useKeepInViewport(panelRef, true);
  useDismiss({
    open: true,
    panelRef,
    anchor: () => anchor,
    focusBack: () => anchor,
    onClose,
  });
  useEffect(() => {
    panelRef.current?.focus();
  }, [event.key]);
  const date = localDate(Date.parse(event.start));
  const close = () => {
    onClose();
    if (anchor.isConnected) anchor.focus();
  };
  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = event.currentTarget;
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (event.key === 'Tab' && event.shiftKey && document.activeElement === panel) {
      event.preventDefault();
      focusables().at(-1)?.focus();
      return;
    }
    wrapTabFocus(event, focusables);
  };
  return (
    <div
      ref={panelRef}
      className="mo-pop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      style={place}
      onKeyDown={keepFocusInside}
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
      <EventInfo event={event} now={props.now} />
      <EventActions
        event={event}
        isToday={date === props.today}
        now={props.now}
        onStartChat={props.onStartChat}
      />
    </div>
  );
}
