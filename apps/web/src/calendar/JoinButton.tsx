import { JOIN_LEAD_MS, joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { clock } from './calendar-format.ts';
import { openJoin } from './today-model.ts';

interface JoinButtonProps {
  event: CalendarEvent;
  now: number;
  label?: string;
  className?: string;
  plain?: boolean;
  onJoined?: (event: CalendarEvent) => void;
}

export function JoinButton({
  event,
  now,
  label = 'Join',
  className = '',
  plain = false,
  onJoined,
}: JoinButtonProps) {
  const link = event.link;
  if (!link) return null;
  const { start, end } = spanOf(event);
  const open = joinOpen({ start, end }, now);
  const ended = now >= end;
  const shown = open ? label : ended ? 'Ended' : clock(start);
  const name = open
    ? `${label} ${event.title}`
    : ended
      ? `${event.title} has ended`
      : `${event.title} at ${clock(start)}, Join opens at ${clock(start - JOIN_LEAD_MS)}`;
  return (
    <button
      type="button"
      className={
        plain ? className : `${open ? 'btn primary sm' : 'btn line sm'} ${className}`.trim()
      }
      disabled={!open}
      data-open={open || undefined}
      aria-label={name}
      title={open ? undefined : name}
      onClick={() => {
        openJoin(link.url);
        onJoined?.(event);
      }}
    >
      {shown}
    </button>
  );
}
