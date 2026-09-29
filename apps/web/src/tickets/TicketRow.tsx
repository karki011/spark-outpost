import type { ReactNode } from 'react';
import type { TicketSourceId, TicketStatus } from '@spark-outpost/contracts';
import { Glyph, PriorityGlyph, StatusCircle } from './ticket-icons.tsx';

export type RowTone = 'none' | 'warn' | 'error' | 'running';

export interface RowButton {
  label: string;
  name: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface TicketRowProps {
  id: string;
  source: TicketSourceId;
  ticketKey: string;
  title: string;
  priorityRank: number;
  status?: { status: TicketStatus; label: string };
  reason: string;
  tone: RowTone;
  more: string[];
  age: { text: string; title: string } | null;
  syncProblem?: string | null;
  snoozedUntil?: string | null;
  selected: boolean;
  onSelect: () => void;
  action: RowButton | null;
  pinned?: ReactNode;
  below?: ReactNode;
}

const TONE_CLASS: Record<RowTone, string> = {
  none: 'sev',
  warn: 'sev warn',
  error: 'sev bad',
  running: 'sev run',
};

export function TicketRow(props: TicketRowProps) {
  const { action, pinned, below } = props;
  const classes = [
    'irow',
    action ? 'acts' : '',
    props.selected ? 'sel' : '',
    pinned ? 'pinned' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li className={classes} data-ticket={props.id}>
      <button
        type="button"
        className={props.status ? 'ir-main with-status' : 'ir-main'}
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
      >
        <span className="srcl" aria-hidden="true">
          {props.source === 'linear' ? 'L' : 'J'}
        </span>
        {props.status && <StatusCircle status={props.status.status} label={props.status.label} />}
        <PriorityGlyph rank={props.priorityRank} />
        <span className="tk-key">{props.ticketKey}</span>
        <span className="tk-title">{props.title}</span>
        <span className="why-r">
          <i className={TONE_CLASS[props.tone]} aria-hidden="true" />
          <span className="txt">{props.reason}</span>
          {props.more.length > 0 && (
            <span className="tk-more" title={props.more.join(' · ')}>
              +{props.more.length}
              <span className="sr-only">: {props.more.join(', ')}</span>
            </span>
          )}
          {props.snoozedUntil && (
            <span className="snz-tag" title={`Snoozed until ${props.snoozedUntil}`}>
              <Glyph name="snooze" size={11} />
              {props.snoozedUntil}
            </span>
          )}
          {props.syncProblem && (
            <span className="syncw" title={props.syncProblem}>
              <Glyph name="warn" size={13} />
              <span className="sr-only">{props.syncProblem}</span>
            </span>
          )}
        </span>
        <span className="age" title={props.age?.title}>
          {props.age?.text}
        </span>
      </button>
      {(action || pinned) && (
        <div className={pinned ? 'ir-acts pin' : 'ir-acts'}>
          {pinned ??
            (action && (
              <button
                type="button"
                className={action.primary ? 'qa primary' : 'qa'}
                aria-label={action.name}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
        </div>
      )}
      {below}
    </li>
  );
}
