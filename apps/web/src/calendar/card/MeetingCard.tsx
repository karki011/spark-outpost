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
  onDismiss?: (() => void) | undefined;
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

export function MeetingCardBody(props: MeetingCardBodyProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const more = [
    ...(props.more ?? []),
    ...(props.onDismiss ? [{ label: 'Dismiss', onAct: props.onDismiss }] : []),
  ];
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
        {more.length > 0 && (
          <button
            type="button"
            className="mc-btn mc-more"
            aria-label="More actions"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            ···
          </button>
        )}
      </div>
      {more.length > 0 && (
        <div id={moreId} className="mc-more-acts" hidden={!moreOpen}>
          {more.map((action) => (
            <CardButton key={action.label} label={action.label} onClick={action.onAct} />
          ))}
        </div>
      )}
      {props.hint && <p className="mc-hint">{props.hint}</p>}
      <button
        type="button"
        className="mc-x"
        title="Close"
        aria-label={props.closeLabel}
        onClick={props.onClose}
      >
        <XIcon />
      </button>
    </>
  );
}
