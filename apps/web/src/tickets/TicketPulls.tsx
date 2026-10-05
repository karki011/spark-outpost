import { useId } from 'react';
import type { InboxTicket, TicketRef } from '@spark-outpost/contracts';
import { ticketPulls, type PullEntry } from './row-links.ts';
import { ChecksBadge } from './StatusChip.tsx';
import { Glyph } from './ticket-icons.tsx';
import { safeUrl } from './ticket-model.ts';
import './ticket-pulls.css';

const CHAT_TEXT: Record<NonNullable<InboxTicket['chat']>['state'], string> = {
  asking: 'Waiting for your answer',
  running: 'Running',
  error: 'Stopped with an error',
  finished: 'Finished',
  idle: 'Idle',
};

function pullName(entry: PullEntry): string {
  if (entry.number === null) return 'Pull request';
  return entry.repo ? `${entry.repo} #${entry.number}` : `#${entry.number}`;
}

const reviewText = (entry: PullEntry) =>
  entry.badge.label.charAt(0).toUpperCase() + entry.badge.label.slice(1);

function PullLink({ entry }: { entry: PullEntry }) {
  return (
    <li>
      <a className="pr-item" href={safeUrl(entry.url)} target="_blank" rel="noreferrer">
        <span className={`irl-pr ${entry.badge.tone}`}>
          <Glyph name={entry.badge.glyph} size={13} />
          <span>{entry.number === null ? 'PR' : `#${entry.number}`}</span>
        </span>
        <span className="pr-t">
          <b>{entry.title ?? pullName(entry)}</b>
          <small>
            {entry.title ? `${pullName(entry)} · ` : ''}
            {reviewText(entry)}
          </small>
          {entry.failedChecks.length > 0 && (
            <small className="pr-failed">Failed: {entry.failedChecks.join(', ')}</small>
          )}
        </span>
        {entry.checks && <ChecksBadge checks={entry.checks} />}
      </a>
    </li>
  );
}

interface PullRequestsProps {
  ticket: InboxTicket | null;
  trackerLinks: readonly TicketRef[];
}

interface LinkedWorkProps extends PullRequestsProps {
  onOpenChat: (conversationId: string) => void;
}

export function LinkedWork({ ticket, trackerLinks, onOpenChat }: LinkedWorkProps) {
  const workId = useId();
  const chat = ticket?.chat;
  const create =
    ticketPulls(ticket, trackerLinks).length > 0
      ? null
      : ticket?.work.flatMap((work) => work.prLinks ?? []).at(-1);
  const createUrl = safeUrl(create?.url ?? null);
  return (
    <section className="tk-sec" aria-labelledby={workId}>
      <h4 id={workId}>Linked work</h4>
      {chat ? (
        <button type="button" className="linked" onClick={() => onOpenChat(chat.conversationId)}>
          <Glyph name="chat" />
          <span>
            <b>{chat.title}</b>
            <small>Chat · {CHAT_TEXT[chat.state]}</small>
          </span>
        </button>
      ) : (
        <p className="tk-quiet">No chat yet. Start work to create a chat linked to this ticket.</p>
      )}
      {create && createUrl && (
        <a className="btn line sm" href={createUrl} target="_blank" rel="noreferrer">
          {create.title}
        </a>
      )}
    </section>
  );
}

export function PullRequests({
  ticket,
  trackerLinks,
  lead,
}: PullRequestsProps & { lead?: boolean }) {
  const pullsId = useId();
  const pulls = ticketPulls(ticket, trackerLinks);
  return (
    <section className={lead ? 'tk-sec lead' : 'tk-sec'} aria-labelledby={pullsId}>
      <h4 id={pullsId}>Pull requests</h4>
      {pulls.length === 0 ? (
        <p className="tk-quiet">No pull request is linked to this ticket yet.</p>
      ) : (
        <ul className="pr-list">
          {pulls.map((entry) => (
            <PullLink key={entry.url} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
