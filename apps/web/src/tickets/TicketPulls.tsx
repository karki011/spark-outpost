import { useId } from 'react';
import type { InboxTicket, PullRequestChecks, TicketRef } from '@spark-outpost/contracts';
import { ticketPulls, type PullEntry } from './row-links.ts';
import { Glyph } from './ticket-icons.tsx';
import { safeUrl } from './ticket-model.ts';
import './ticket-pulls.css';

const CHECKS: Record<PullRequestChecks, string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
};

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

function stateText(entry: PullEntry): string {
  const checks = entry.checks ? CHECKS[entry.checks] : null;
  const state = entry.badge.label.charAt(0).toUpperCase() + entry.badge.label.slice(1);
  return checks && checks !== entry.badge.label ? `${state} · ${checks}` : state;
}

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
            {stateText(entry)}
          </small>
        </span>
      </a>
    </li>
  );
}

interface TicketPullsProps {
  ticket: InboxTicket | null;
  trackerLinks: readonly TicketRef[];
  onOpenChat: (conversationId: string) => void;
}

export function TicketPulls({ ticket, trackerLinks, onOpenChat }: TicketPullsProps) {
  const workId = useId();
  const pullsId = useId();
  const chat = ticket?.chat;
  const pulls = ticketPulls(ticket, trackerLinks);
  const create =
    pulls.length > 0 ? null : ticket?.work.flatMap((work) => work.prLinks ?? []).at(-1);
  const createUrl = safeUrl(create?.url ?? null);
  return (
    <>
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
          <p className="tk-quiet">
            No chat yet. Start work to create a chat linked to this ticket.
          </p>
        )}
        {create && createUrl && (
          <a className="btn line sm" href={createUrl} target="_blank" rel="noreferrer">
            {create.title}
          </a>
        )}
      </section>
      <section className="tk-sec" aria-labelledby={pullsId}>
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
    </>
  );
}
