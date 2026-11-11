import { isReadOnlyTable, type TicketSourceId, type TicketView } from '@spark-outpost/contracts';
import { useId, useState } from 'react';
import { UserBlob } from '../brand/UserBlob.tsx';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { LinkedTickets } from './LinkedTickets.tsx';
import { safeUrl } from './ticket-model.ts';
import { ServiceNowNotes, VisibilityTag } from './ServiceNowNotes.tsx';
import { TicketComment } from './TicketComment.tsx';
import { DetailSkeleton } from './TicketsSkeleton.tsx';

interface TicketBodyProps {
  view: TicketView | undefined;
  loading: boolean;
  error: Error | null;
  source: string;
  loaded: ReadonlySet<string>;
  onOpenLinked: (source: TicketSourceId, key: string) => void;
}

export function TicketBody({
  view,
  loading,
  error,
  source,
  loaded,
  onOpenLinked,
}: TicketBodyProps) {
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
  const plain = ticket.source === 'servicenow';
  const writable = plain && !isReadOnlyTable(ticket.project);
  return (
    <>
      <section className="tk-sec">
        <h4>
          Description <span className="live-note">Loaded from {source} just now</span>
        </h4>
        {ticket.description.trim() ? (
          <div className="tk-desc" tabIndex={0} aria-label="Description">
            {plain ? (
              <p className="tk-plain">{ticket.description}</p>
            ) : (
              <Markdown text={ticket.description} />
            )}
          </div>
        ) : (
          <p className="tk-quiet">No description.</p>
        )}
      </section>
      <LinkedTickets ticket={ticket} loaded={loaded} onOpen={onOpenLinked} />
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
                    {comment.visibility && <VisibilityTag visibility={comment.visibility} />}
                  </div>
                  {plain ? (
                    <p className="tk-plain">{comment.body}</p>
                  ) : (
                    <Markdown text={comment.body} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {(ticket.attachments ?? []).length > 0 && (
        <section className="tk-sec">
          <h4>Attachments</h4>
          <ul className="tk-attach">
            {ticket.attachments?.map((file) => (
              <li key={file.name}>
                {file.name} · {formatBytes(file.bytes)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!plain && (
        <TicketComment source={ticket.source} ticketKey={ticket.key} sourceName={source} />
      )}
      {writable && <ServiceNowNotes key={`${ticket.source}:${ticket.key}`} ticket={ticket} />}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
