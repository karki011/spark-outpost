import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { keepInViewport } from '../ui/viewport-clamp.ts';
import { clock, dayTitle } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';

const CLOSE_DELAY_MS = 160;
const GAP = 4;

interface MoreEventsProps {
  date: string;
  events: readonly CalendarEvent[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  focusable: boolean;
  onDate: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

function placeUnder(list: HTMLElement, anchor: HTMLElement): void {
  list.style.left = '0px';
  list.style.top = '0px';
  const origin = list.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  list.style.left = `${rect.left - origin.left}px`;
  list.style.top = `${rect.bottom + GAP - origin.top}px`;
  keepInViewport(list);
}

export function MoreEvents({ date, events, calendars, focusable, ...actions }: MoreEventsProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const listId = useId();
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (open && listRef.current && buttonRef.current)
      placeUnder(listRef.current, buttonRef.current);
  }, [open]);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const inside = (node: EventTarget | null) =>
    node instanceof Node &&
    (buttonRef.current?.contains(node) || listRef.current?.contains(node) || false);
  const onBlur = (event: FocusEvent) => {
    if (!inside(event.relatedTarget)) setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };
  const pick = (event: CalendarEvent) => (click: MouseEvent) => {
    click.stopPropagation();
    setOpen(false);
    actions.onDate(date);
    if (buttonRef.current) actions.onOpenEvent(event, buttonRef.current);
  };
  const label = `${events.length} more ${events.length === 1 ? 'event' : 'events'} on ${dayTitle(date)}`;

  return (
    <span
      className="mo-more-wrap"
      onPointerEnter={show}
      onPointerLeave={hideSoon}
      onFocus={show}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        className="mo-more"
        tabIndex={focusable ? 0 : -1}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={(click) => {
          click.stopPropagation();
          actions.onDate(date);
        }}
      >
        {events.length} more
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          className="mo-more-list"
          role="group"
          aria-label={label}
          onPointerEnter={show}
          onPointerLeave={hideSoon}
        >
          <ul>
            {events.map((event) => (
              <li key={event.key}>
                <button
                  type="button"
                  className="mo-ev"
                  style={swatch(calendars.get(event.calendarKey)?.color ?? '') as CSSProperties}
                  onClick={pick(event)}
                >
                  <span className="mo-at">
                    {event.allDay ? 'All day' : clock(Date.parse(event.start))}
                  </span>
                  <span className="mo-ev-title">{event.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
