import type { ReactNode } from 'react';
import { ticketSourceIdSchema, type GithubInboxItem } from '@spark-outpost/contracts';
import { webLink } from '../outposts/post-text.ts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { requestTicket } from '../tickets/ticket-request.ts';
import { XIcon } from '../ui/icons.tsx';
import { ageLabel, checksLine, prState, sizeLine } from './github-model.ts';
import { ReviewBlock } from './review/ReviewBlock.tsx';
import { NewCommitsPill, StatePill } from './StatePill.tsx';

interface GithubDetailProps {
  item: GithubInboxItem;
  now: number;
  onClose: () => void;
  onOpenChat: (conversationId: string) => void;
}

function TicketBlock({ ticket }: { ticket: NonNullable<GithubInboxItem['ticket']> }) {
  const source = ticketSourceIdSchema.safeParse(ticket.source);
  const href = ticket.url ? webLink(ticket.url) : undefined;
  const text = (
    <>
      <span className="gh-chip">{ticket.key}</span>
      <span className="gh-ticket-title">{ticket.title ?? 'Ticket'}</span>
      {ticket.status && <small>{ticket.status}</small>}
    </>
  );
  if (source.success) {
    return (
      <button
        type="button"
        className="gh-ticket"
        aria-label={`Open ticket ${ticket.key} in Tickets`}
        onClick={() => requestTicket({ source: source.data, key: ticket.key })}
      >
        {text}
      </button>
    );
  }
  if (href) {
    return (
      <a className="gh-ticket" href={href} target="_blank" rel="noreferrer">
        {text}
      </a>
    );
  }
  return <div className="gh-ticket">{text}</div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function names(list: string[]): string {
  return list.length > 0 ? list.join(', ') : 'No one';
}

export function GithubDetail({ item, now, onClose, onOpenChat }: GithubDetailProps) {
  const state = prState(item);
  const size = sizeLine(item);
  const href = webLink(item.url);
  const conversationId = item.conversationId;
  return (
    <aside className="gh-detail" aria-labelledby="gh-detail-title">
      <header className="gh-detail-head">
        <h3 id="gh-detail-title">{item.title}</h3>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close details"
          title="Close details · Esc"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </header>
      <p className="gh-detail-sub">
        {item.repo} #{item.number} · {item.author} · updated {ageLabel(item.updatedAt, now)} ago
      </p>
      <div className="gh-detail-pills">
        {state && <StatePill state={state} />}
        {item.updatedSinceSeen && <NewCommitsPill />}
      </div>
      <dl className="gh-facts">
        <Fact label="Checks">{checksLine(item)}</Fact>
        {item.conflict && <Fact label="Branch">Has a merge conflict</Fact>}
        {!item.conflict && item.behind && <Fact label="Branch">Behind its base</Fact>}
        {item.changesRequested && <Fact label="Review">Changes requested</Fact>}
        {item.openThreads !== null && item.openThreads > 0 && (
          <Fact label="Threads">{item.openThreads} open</Fact>
        )}
        {size && <Fact label="Size">{size}</Fact>}
        <Fact label="Waiting on">{names(item.waitingOn)}</Fact>
        <Fact label="Approved by">{names(item.approvedBy)}</Fact>
      </dl>
      {item.ticket && <TicketBlock ticket={item.ticket} />}
      <div className="gh-detail-actions">
        {conversationId && (
          <button
            type="button"
            className="btn primary sm"
            onClick={() => onOpenChat(conversationId)}
          >
            <Glyph name="chat" size={13} />
            Open chat
          </button>
        )}
        {href && (
          <a
            className={conversationId ? 'btn line sm' : 'btn primary sm'}
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            <Glyph name="pr" size={13} />
            Open on GitHub
          </a>
        )}
      </div>
      <ReviewBlock key={item.id} item={item} />
    </aside>
  );
}
