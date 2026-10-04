import type { TicketView } from '@spark-outpost/contracts';
import { useId, useState } from 'react';
import { UserBlob } from '../brand/UserBlob.tsx';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { StatusBadge } from './StatusChip.tsx';
import { safeUrl } from './ticket-model.ts';
import { DetailSkeleton } from './TicketsSkeleton.tsx';

interface TicketBodyProps {
  view: TicketView | undefined;
  loading: boolean;
  error: Error | null;
  source: string;
}

export function TicketBody({ view, loading, error, source }: TicketBodyProps) {
  const commentsId = useId();
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null);
  if (loading) {
    return (
      <section className="tk-sec" aria-busy="true">
        <h4>Description</h4>
        <p className="sr-only" role="status">
          Loading the description from {source}
        </p>
        <DetailSkeleton />
      </section>
    );
  }
  if (error || !view) {
    return (
      <section className="tk-sec">
        <h4>Description</h4>
        <p className="tk-quiet" role="alert">
          {error?.message ?? `Couldn't load this ticket from ${source}.`}
        </p>
      </section>
    );
  }
  const { ticket } = view;
  const commentsOpen = commentsOpenFor === ticket.key;
  return (
    <>
      <section className="tk-sec">
        <h4>
          Description <span className="live-note">Loaded from {source} just now</span>
        </h4>
        {ticket.description.trim() ? (
          <div className="tk-desc" tabIndex={0} aria-label="Description">
            <Markdown text={ticket.description} />
          </div>
        ) : (
          <p className="tk-quiet">No description.</p>
        )}
      </section>
      {ticket.subtasks.length > 0 && (
        <section className="tk-sec">
          <h4>Subtasks</h4>
          {ticket.subtasks.map((subtask) => (
            <div key={subtask.key} className="subt">
              <span className="tk-key">{subtask.key}</span>
              <span className="t">{subtask.title}</span>
              <StatusBadge status={subtask.status} name={subtask.statusName} />
            </div>
          ))}
        </section>
      )}
      {ticket.links.length > 0 && (
        <section className="tk-sec">
          <h4>Links</h4>
          {ticket.links.map((link) => (
            <p key={link.url} className="xlink">
              <a href={safeUrl(link.url)} target="_blank" rel="noreferrer">
                {link.title}
              </a>
            </p>
          ))}
        </section>
      )}
      {ticket.comments.length > 0 && (
        <section className="tk-sec">
          <h4>
            <button
              type="button"
              className="tk-cmt-toggle"
              aria-expanded={commentsOpen}
              aria-controls={commentsId}
              onClick={() => setCommentsOpenFor(commentsOpen ? null : ticket.key)}
            >
              <ChevronIcon />
              Comments
              <span className="tk-cmt-count">{ticket.comments.length}</span>
            </button>
          </h4>
          {commentsOpen && (
            <ol id={commentsId} className="tk-cmts">
              {ticket.comments.map((comment, index) => (
                <li key={`${comment.createdAt}-${index}`} className="cmt">
                  <div className="cmt-head">
                    <UserBlob displayName={comment.author ?? 'Someone'} size={22} />
                    <b>{comment.author ?? 'Someone'}</b>
                    <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
                  </div>
                  <Markdown text={comment.body} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
