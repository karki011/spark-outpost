import './calendar-parts.css';
import { useId } from 'react';
import { joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { clock } from './calendar-format.ts';
import { openJoin } from './today-model.ts';
import { useJoinLeadMs } from './use-calendar.ts';

interface JoinButtonProps {
  event: CalendarEvent;
  now: number;
  label?: string;
  className?: string;
  plain?: boolean;
  early?: 'time' | 'subtle';
  onJoined?: (event: CalendarEvent) => void;
}

function EarlyJoin(props: {
  event: CalendarEvent;
  label: string;
  className: string;
  leadMs: number;
}) {
  const { event, label } = props;
  const hintId = useId();
  const opensAt = clock(spanOf(event).start - props.leadMs);
  const tip = useTooltip(`Join opens at ${opensAt}`);
  return (
    <span className={`cal-join-early ${props.className}`.trim()}>
      <button
        {...tip.triggerProps}
        type="button"
        className="btn line sm"
        aria-disabled="true"
        aria-label={`${label} ${event.title}`}
        aria-describedby={hintId}
      >
        {label}
      </button>
      {tip.tooltip}
      <small id={hintId}>Opens at {opensAt}</small>
    </span>
  );
}

function WaitingJoin(props: { name: string; className: string; plain: boolean; shown: string }) {
  const tip = useTooltip(props.name);
  const button = (
    <button
      {...(props.plain ? tip.triggerProps : {})}
      type="button"
      className={props.plain ? props.className : `btn line sm ${props.className}`.trim()}
      disabled
      aria-label={props.name}
    >
      {props.shown}
    </button>
  );
  if (props.plain) {
    return (
      <>
        {button}
        {tip.tooltip}
      </>
    );
  }
  return (
    <span className="cal-join-tip" {...tip.triggerProps}>
      {button}
      {tip.tooltip}
    </span>
  );
}

export function JoinButton({
  event,
  now,
  label = 'Join',
  className = '',
  plain = false,
  early = 'time',
  onJoined,
}: JoinButtonProps) {
  const leadMs = useJoinLeadMs();
  const link = event.link;
  if (!link) return null;
  const { start, end } = spanOf(event);
  const open = joinOpen({ start, end }, now, leadMs);
  const ended = now >= end;
  if (!open && !ended && early === 'subtle')
    return <EarlyJoin event={event} label={label} className={className} leadMs={leadMs} />;
  const shown = open ? label : ended ? 'Ended' : clock(start);
  const name = open
    ? `${label} ${event.title}`
    : ended
      ? `${event.title} has ended`
      : `${event.title} at ${clock(start)}, Join opens at ${clock(start - leadMs)}`;
  if (!open) return <WaitingJoin name={name} className={className} plain={plain} shown={shown} />;
  return (
    <button
      type="button"
      className={plain ? className : `btn primary sm ${className}`.trim()}
      data-open
      aria-label={name}
      onClick={() => {
        openJoin(link.url);
        onJoined?.(event);
      }}
    >
      {shown}
    </button>
  );
}
