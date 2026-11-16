import './meeting-card.css';
import { useId, useState, type ReactNode } from 'react';
import { XIcon } from '../../ui/icons.tsx';

export interface MeetingCardRow {
  key: string;
  text: string;
  icon?: ReactNode;
  tone?: 'warn';
}

export interface MoreAction {
  label: string;
  onAct: () => void;
}

interface MeetingCardBodyProps {
  kicker: string;
  kickerId?: string;
  ended?: boolean;
  title: string;
  titleId?: string;
  rows: readonly MeetingCardRow[];
  agenda?: string | null;
  compact?: boolean;
  status?: ReactNode;
  list?: ReactNode;
  children: ReactNode;
  more?: readonly MoreAction[];
  closeLabel: string;
  onClose: () => void;
  hint?: ReactNode;
}

export function CardButton(props: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={props.primary ? 'mc-btn primary' : 'mc-btn'}
      aria-label={props.ariaLabel}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function More({ actions }: { actions: readonly MoreAction[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <button
        type="button"
        className="mc-btn mc-more"
        aria-label="More actions"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        ···
      </button>
      <div id={listId} className="mc-more-acts" hidden={!open}>
        {actions.map((action) => (
          <CardButton key={action.label} label={action.label} onClick={action.onAct} />
        ))}
      </div>
    </>
  );
}

export function MeetingCardBody(props: MeetingCardBodyProps) {
  return (
    <>
      <p id={props.kickerId} className="mc-kicker" data-ended={props.ended || undefined}>
        {props.kicker}
      </p>
      <p id={props.titleId} className="mc-title" title={props.title}>
        {props.title}
      </p>
      {props.rows.length > 0 && (
        <ul className="mc-rows">
          {props.rows.map((row) => (
            <li key={row.key} className="mc-row" data-tone={row.tone}>
              {row.icon && (
                <span className="mc-icon" aria-hidden="true">
                  {row.icon}
                </span>
              )}
              <span className="mc-text">{row.text}</span>
            </li>
          ))}
        </ul>
      )}
      {!props.compact && props.agenda && <p className="mc-agenda">{props.agenda}</p>}
      {props.list}
      {props.status}
      <div className="mc-acts">
        {props.children}
        <CardButton label="Dismiss" ariaLabel={props.closeLabel} onClick={props.onClose} />
        {props.more && props.more.length > 0 && <More actions={props.more} />}
      </div>
      {props.hint && <p className="mc-hint">{props.hint}</p>}
      <button
        type="button"
        className="mc-x"
        title="Dismiss"
        aria-hidden="true"
        tabIndex={-1}
        onClick={props.onClose}
      >
        <XIcon />
      </button>
    </>
  );
}
