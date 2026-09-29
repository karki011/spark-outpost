import type { TicketView } from '@spark-outpost/contracts';
import { ticketStatusLabels } from '@spark-outpost/contracts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { StatusCircle } from './ticket-icons.tsx';
import { safeUrl } from './ticket-model.ts';
import { DetailSkeleton } from './TicketsSkeleton.tsx';

interface TicketBodyProps {
  view: TicketView | undefined;
  loading: boolean;
  error: Error | null;
  source: string;
}

export function TicketBody({ view, loading, error, source }: TicketBodyProps) {
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
  return (
    <>
      <section className="tk-sec">
        <h4>
          Description <span className="live-note">Loaded from {source} just now</span>
        </h4>
        {ticket.description.trim() ? (
          <Markdown text={ticket.description} />
        ) : (
          <p className="tk-quiet">No description.</p>
        )}
      </section>
      {ticket.subtasks.length > 0 && (
        <section className="tk-sec">
          <h4>Subtasks</h4>
          {ticket.subtasks.map((subtask) => (
            <div key={subtask.key} className="subt">
              <StatusCircle status={subtask.status} label={ticketStatusLabels[subtask.status]} />
              <span className="tk-key">{subtask.key}</span>
              <span className="t">{subtask.title}</span>
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
          <h4>Comments</h4>
          {ticket.comments.map((comment, index) => (
            <div key={`${comment.createdAt}-${index}`} className="cmt">
              <div className="cb">
                <b>{comment.author ?? 'Someone'}</b>
                <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
                <p>{comment.body}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
