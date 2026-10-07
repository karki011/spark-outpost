import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketSourceNames, type InboxTicket, type TicketSummary } from '@spark-outpost/contracts';
import { UserBlob } from '../brand/UserBlob.tsx';
import type { ToastSpec } from '../conversations/use-toast.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { AssignConfirm } from './AssignConfirm.tsx';
import { DetailResizer } from './DetailResizer.tsx';
import { DETAIL_DEFAULT_WIDTH } from './detail-width.ts';
import { SnoozeButton, SnoozedNote, SnoozeError, useSnooze } from './SnoozeControl.tsx';
import { StatusBadge } from './StatusChip.tsx';
import { Glyph, PriorityGlyph } from './ticket-icons.tsx';
import { TicketBody } from './TicketBody.tsx';
import { pullUrl, safeUrl } from './ticket-model.ts';
import { createdText, exactDate } from './ticket-status.ts';
import { Development, LinkedWork } from './TicketPulls.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';
import { useDismiss } from './use-dismiss.ts';

export type DetailTicket = TicketSummary & {
  mine: boolean;
  inbox: InboxTicket | null;
};

interface TicketDetailProps {
  ticket: DetailTicket;
  assigning: boolean;
  confirming: boolean;
  assignError: string | null;
  now: number;
  width: number | null;
  onWidth: (width: number | null) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onClose: () => void;
  onAssign: () => void;
  onStart: () => void;
  onOpenChat: (conversationId: string) => void;
  onToast: (toast: ToastSpec) => void;
}

const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

function WhyBox({ ticket }: { ticket: InboxTicket }) {
  if (ticket.flags.length === 0) return null;
  return (
    <div className="whybox">
      <b>Why it needs attention</b>
      <ul>
        {ticket.flags.map((flag) => (
          <li key={flag.rule}>
            {flag.text}
            {flag.since ? ` · ${relativeTime(flag.since)}` : ''}
            <br />
            <small>{flag.rationale}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Person({ name, note }: { name: string; note?: string }) {
  return (
    <>
      <UserBlob displayName={name} size={18} />
      {name}
      {note}
    </>
  );
}

export function TicketDetail({
  ticket,
  assigning,
  confirming,
  assignError,
  now,
  width,
  onWidth,
  onConfirm,
  onCancelConfirm,
  onClose,
  onAssign,
  onStart,
  onOpenChat,
  onToast,
}: TicketDetailProps) {
  const source = ticketSourceNames[ticket.source];
  const view = useQuery({
    queryKey: ticketKeys.view(ticket.source, ticket.key),
    queryFn: () => ticketsApi.view(ticket.source, ticket.key),
  });
  const inbox = ticket.inbox;
  const chat = inbox?.chat;
  const pr = safeUrl(inbox ? pullUrl(inbox) : null);
  const sync = inbox?.lastSync?.outcome === 'failed' ? inbox.lastSync : null;
  const snoozing = useSnooze(inbox);
  const dismissing = useDismiss(inbox, onToast);
  const flagged = inbox?.section === 'attention' && inbox.flags.length > 0;
  const trackerLinks = view.data?.ticket.links ?? [];
  const pullsFirst = Boolean(inbox?.notice) && !flagged;
  const pulls = (
    <Development
      ticket={inbox}
      trackerLinks={trackerLinks}
      development={view.data?.development ?? inbox?.development}
      sourceName={source}
      loading={view.isPending}
      lead={pullsFirst}
    />
  );

  const created = createdText(ticket.createdAt, now);
  const paneWidth = { '--tk-detail-w': `${width ?? DETAIL_DEFAULT_WIDTH}px` } as CSSProperties;

  return (
    <aside className="tk-detail" aria-label={`${ticket.key} details`} style={paneWidth}>
      <DetailResizer width={width} onWidth={onWidth} />
      <div className="tk-detail-in">
        <div className="tk-dhead">
          <span className="tk-key">
            {source} · {ticket.key}
          </span>
          <a
            className="icon-btn"
            href={safeUrl(ticket.url)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${ticket.key} in ${source}`}
          >
            <ExternalLinkIcon />
          </a>
          <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <h3>{ticket.title}</h3>
        <div className="tk-actions">
          {!ticket.mine && (
            <button
              type="button"
              className="btn primary sm"
              disabled={assigning}
              onClick={onAssign}
            >
              <Glyph name="assign" />
              {assigning ? `Assigning in ${source}…` : 'Assign to me'}
            </button>
          )}
          {chat && (
            <button
              type="button"
              className={ticket.mine ? 'btn primary sm' : 'btn line sm'}
              onClick={() => onOpenChat(chat.conversationId)}
            >
              <Glyph name="chat" />
              {chat.state === 'asking' ? 'Answer in chat' : 'Open chat'}
            </button>
          )}
          {pr && (
            <a className="btn line sm" href={pr} target="_blank" rel="noreferrer">
              <Glyph name="pr" />
              Open PR
            </a>
          )}
          <button
            type="button"
            className={ticket.mine && !chat ? 'btn primary sm' : 'btn line sm'}
            onClick={onStart}
          >
            <Glyph name="play" />
            {chat ? 'Start again' : 'Start work'}
          </button>
          {inbox && flagged && (
            <>
              <SnoozeButton ticket={inbox} snoozing={snoozing} />
              <button
                type="button"
                className="btn line sm"
                aria-label={`Dismiss ${ticket.key} from Needs you`}
                title="Clears it from Needs you until something changes"
                disabled={dismissing.pending}
                onClick={dismissing.dismiss}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
        {confirming && (
          <AssignConfirm ticket={ticket} onCancel={onCancelConfirm} onConfirm={onConfirm} />
        )}
        {assignError && (
          <div className="sync fail" role="alert">
            <Glyph name="warn" />
            <span>{assignError}</span>
          </div>
        )}
        <SnoozeError snoozing={snoozing} />
        {dismissing.error && (
          <p className="snz-err" role="alert">
            Couldn't dismiss {ticket.key}. {dismissing.error}
          </p>
        )}
        {inbox && <SnoozedNote ticket={inbox} snoozing={snoozing} />}
        {inbox && <WhyBox ticket={inbox} />}
        {pullsFirst && pulls}
        {sync && (
          <div className="sync fail" role="alert">
            <Glyph name="warn" />
            <span>{sync.message ?? `The last change to ${ticket.key} failed in ${source}.`}</span>
          </div>
        )}
        <dl className="tk-props">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={ticket.status} name={ticket.statusName} />
          </dd>
          <dt>Priority</dt>
          <dd>
            <PriorityGlyph rank={ticket.priorityRank} />
            {ticket.priority ?? PRIORITY_NAMES[ticket.priorityRank]}
          </dd>
          <dt>Due</dt>
          <dd>{ticket.dueDate ?? 'No due date'}</dd>
          <dt>{ticket.source === 'linear' ? 'Team' : 'Project'}</dt>
          <dd>{ticket.project ?? 'None'}</dd>
          <dt>{ticket.source === 'linear' ? 'Cycle' : 'Sprint'}</dt>
          <dd>{ticket.sprint ?? 'None'}</dd>
          <dt>Assignee</dt>
          <dd>
            {ticket.assignedTo ? (
              <Person name={ticket.assignedTo.name} {...(ticket.mine ? { note: ' (you)' } : {})} />
            ) : (
              <>
                <span className="ir-who none" aria-hidden="true" />
                Unassigned
              </>
            )}
          </dd>
          <dt>Reporter</dt>
          <dd>
            {ticket.reporter ? (
              <Person name={ticket.reporter.name} />
            ) : (
              <span className="tk-unknown">Not known</span>
            )}
          </dd>
          <dt>Created</dt>
          <dd>
            {ticket.createdAt && created ? (
              <time dateTime={ticket.createdAt} title={exactDate(ticket.createdAt)}>
                {created}
              </time>
            ) : (
              <span className="tk-unknown">Not known</span>
            )}
          </dd>
          <dt>Labels</dt>
          <dd>
            {ticket.labels.length === 0
              ? 'None'
              : ticket.labels.map((label) => (
                  <span key={label} className="lbl">
                    {label}
                  </span>
                ))}
          </dd>
          <dt>Updated</dt>
          <dd>{relativeTime(ticket.updatedAt)}</dd>
        </dl>
        <LinkedWork ticket={inbox} trackerLinks={trackerLinks} onOpenChat={onOpenChat} />
        {!pullsFirst && pulls}
        <TicketBody view={view.data} loading={view.isPending} error={view.error} source={source} />
      </div>
    </aside>
  );
}
