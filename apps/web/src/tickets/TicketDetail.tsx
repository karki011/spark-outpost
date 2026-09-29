import { useQuery } from '@tanstack/react-query';
import {
  ticketSourceNames,
  ticketStatusLabels,
  type InboxTicket,
  type PullRequestState,
  type TicketSummary,
} from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { AssignConfirm } from './AssignConfirm.tsx';
import { SnoozeButton, SnoozedNote, SnoozeError, useSnooze } from './SnoozeControl.tsx';
import { Glyph, PriorityGlyph } from './ticket-icons.tsx';
import { TicketBody } from './TicketBody.tsx';
import { pullUrl, safeUrl } from './ticket-model.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export type DetailTicket = TicketSummary & {
  mine: boolean;
  inbox: InboxTicket | null;
};

interface TicketDetailProps {
  ticket: DetailTicket;
  assigning: boolean;
  confirming: boolean;
  assignError: string | null;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onClose: () => void;
  onAssign: () => void;
  onStart: () => void;
  onOpenChat: (conversationId: string) => void;
}

const PR_STATES: Record<PullRequestState, string> = {
  draft: 'Draft',
  review: 'Waiting on reviewers',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed without merging',
};

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

function LinkedWork({
  ticket,
  onOpenChat,
}: {
  ticket: InboxTicket | null;
  onOpenChat: (id: string) => void;
}) {
  const chat = ticket?.chat;
  const pull = ticket?.pullRequest ?? null;
  const url = safeUrl(ticket ? pullUrl(ticket) : null);
  if (!chat && !url) {
    return (
      <p className="tk-quiet">
        No chats or pull requests yet. Start work to create a chat linked to this ticket.
      </p>
    );
  }
  return (
    <>
      {chat && (
        <button type="button" className="linked" onClick={() => onOpenChat(chat.conversationId)}>
          <Glyph name="chat" />
          <span>
            <b>{chat.title}</b>
            <small>Chat · {chat.state === 'asking' ? 'Waiting for your answer' : chat.state}</small>
          </span>
        </button>
      )}
      {url && (
        <div className="prbox">
          <a href={url} target="_blank" rel="noreferrer">
            {pull ? `${pull.repo} #${pull.number}` : url}
          </a>
          <dl>
            <dt>Status</dt>
            <dd>
              {pull ? PR_STATES[pull.state] : <span className="na-txt">Not available yet</span>}
            </dd>
            <dt>Opened</dt>
            <dd>
              {pull ? (
                relativeTime(pull.openedAt)
              ) : (
                <span className="na-txt">Not available yet</span>
              )}
            </dd>
            {pull?.mergedAt && (
              <>
                <dt>Merged</dt>
                <dd>{relativeTime(pull.mergedAt)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}

export function TicketDetail({
  ticket,
  assigning,
  confirming,
  assignError,
  onConfirm,
  onCancelConfirm,
  onClose,
  onAssign,
  onStart,
  onOpenChat,
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

  return (
    <aside className="tk-detail" aria-label={`${ticket.key} details`}>
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
          <button type="button" className="btn primary sm" disabled={assigning} onClick={onAssign}>
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
        {inbox?.section === 'attention' && inbox.flags.length > 0 && (
          <SnoozeButton ticket={inbox} snoozing={snoozing} />
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
      {inbox && <SnoozedNote ticket={inbox} snoozing={snoozing} />}
      {inbox && <WhyBox ticket={inbox} />}
      {sync && (
        <div className="sync fail" role="alert">
          <Glyph name="warn" />
          <span>{sync.message ?? `The last change to ${ticket.key} failed in ${source}.`}</span>
        </div>
      )}
      <dl className="tk-props">
        <dt>Status</dt>
        <dd>
          <span className={`tk-pill ${ticket.status}`}>{ticketStatusLabels[ticket.status]}</span>
          <span className="native-l">
            {source}: {ticket.statusName}
          </span>
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
          {ticket.assignedTo
            ? `${ticket.assignedTo.name}${ticket.mine ? ' (you)' : ''}`
            : 'Unassigned'}
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
      <section className="tk-sec">
        <h4>Linked work</h4>
        <LinkedWork ticket={inbox} onOpenChat={onOpenChat} />
      </section>
      <TicketBody view={view.data} loading={view.isPending} error={view.error} source={source} />
    </aside>
  );
}
