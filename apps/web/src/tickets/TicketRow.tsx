import type { ReactNode } from 'react';
import type { TicketSourceId, TicketStatus } from '@spark-outpost/contracts';
import { useTooltip, type TipContent } from '../ui/Tooltip.tsx';
import { UserBlob } from '../brand/UserBlob.tsx';
import { StatusBadge } from './StatusChip.tsx';
import { Glyph, PriorityGlyph } from './ticket-icons.tsx';

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
  status: TicketStatus;
  statusName: string;
  assignee: string | null;
  reason: string | null;
  tone: RowTone;
  reasonIcon?: ReactNode;
  reasonBadge?: ReactNode;
  more: string[];
  age: { text: string; title: string } | null;
  syncProblem?: string | null;
  snoozedUntil?: string | null;
  selected: boolean;
  onSelect: () => void;
  action: RowButton | null;
  pinned?: ReactNode;
  below?: ReactNode;
  links?: ReactNode;
  preview?: TipContent;
}

const TONE_CLASS: Record<RowTone, string> = {
  none: 'sev',
  warn: 'sev warn',
  error: 'sev bad',
  running: 'sev run',
};

function Assignee({ name }: { name: string | null }) {
  if (!name) {
    return <span className="ir-who none" role="img" aria-label="Unassigned" title="Unassigned" />;
  }
  return (
    <span className="ir-who" role="img" aria-label={`Assigned to ${name}`} title={name}>
      <UserBlob displayName={name} size={18} />
    </span>
  );
}

const SOURCE_MARKS: Record<TicketSourceId, string> = { linear: 'L', jira: 'J', servicenow: 'S' };

export function TicketRow(props: TicketRowProps) {
  const { action, pinned, below, links } = props;
  const preview = useTooltip(props.preview ?? '');
  return (
    <li className={props.selected ? 'irow sel' : 'irow'} data-ticket={props.id}>
      <button
        type="button"
        className="ir-main"
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
        {...(props.preview ? preview.triggerProps : {})}
      >
        <span className="srcl" aria-hidden="true">
          {SOURCE_MARKS[props.source]}
        </span>
        <PriorityGlyph rank={props.priorityRank} />
        {props.source === 'servicenow' && <span className="sr-only">ServiceNow </span>}
        <span className="tk-key">{props.ticketKey}</span>
        <StatusBadge status={props.status} name={props.statusName} />
        <span className="tk-title">{props.title}</span>
        <span className="why-r">
          {props.reason !== null && (
            <>
              {props.reasonIcon ?? <i className={TONE_CLASS[props.tone]} aria-hidden="true" />}
              <span className="txt">{props.reason}</span>
            </>
          )}
          {props.reasonBadge}
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
        <Assignee name={props.assignee} />
      </button>
      {props.preview && preview.tooltip}
      {links}
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
