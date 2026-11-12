import type { CSSProperties, MouseEvent } from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { clock } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { hasEnded } from './event-clock.ts';
import { eventTip } from './event-tip.ts';
import { replyState } from './reply-status.ts';

interface MonthChipProps {
  event: CalendarEvent;
  calendar: CalendarChoice | undefined;
  now: number;
  selected?: boolean;
  inGrid: boolean;
  onClick: (click: MouseEvent<HTMLButtonElement>) => void;
}

export function MonthChip({ event, calendar, now, selected, inGrid, onClick }: MonthChipProps) {
  const tip = useTooltip(eventTip(event, calendar));
  const showClock = inGrid ? !event.allDay : true;
  const at = event.allDay ? 'All day' : clock(Date.parse(event.start));
  return (
    <>
      <button
        {...tip.triggerProps}
        type="button"
        tabIndex={inGrid ? -1 : undefined}
        aria-hidden={inGrid || undefined}
        className="mo-ev"
        data-focus={event.focus || undefined}
        data-selected={selected || undefined}
        data-ended={hasEnded(event, now) || undefined}
        data-reply={replyState(event.myStatus).look}
        style={swatch(calendar?.color ?? '') as CSSProperties}
        onClick={onClick}
      >
        {showClock && <span className="mo-at">{at}</span>}
        <span className="mo-ev-title">{event.title}</span>
      </button>
      {tip.tooltip}
    </>
  );
}
