import { useId } from 'react';
import type { InboxTicket, TicketDevelopment, TicketRef } from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { buildsText, commitsText, developmentPulls } from './development-model.ts';
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
          {(entry.origin || entry.note) && (
            <small className="pr-origin">
              {[entry.origin, entry.note].filter(Boolean).join(' · ')}
            </small>
          )}
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

interface DevelopmentProps extends PullRequestsProps {
  development: TicketDevelopment | undefined;
  sourceName: string;
  loading: boolean;
  lead?: boolean;
}

function BranchList({ branches }: { branches: TicketDevelopment['branches'] }) {
  return (
    <ul className="dev-list" aria-label="Branches">
      {branches.map((branch) => {
        const url = safeUrl(branch.url);
        return (
          <li key={`${branch.repo ?? ''}:${branch.name}`}>
            <span className="dev-k">Branch</span>
            {url ? (
              <a className="dev-branch" href={url} target="_blank" rel="noreferrer">
                {branch.name}
              </a>
            ) : (
              <span className="dev-branch">{branch.name}</span>
            )}
            {branch.repo && <small>{branch.repo}</small>}
          </li>
        );
      })}
    </ul>
  );
}

function Activity({ development }: { development: TicketDevelopment }) {
  const { commits, builds } = development;
  if (!commits && !builds) return null;
  const built = builds ? buildsText(builds) : null;
  return (
    <ul className="dev-list" aria-label="Commits and builds">
      {commits && (
        <li>
          <span className="dev-k">Commits</span>
          <span>{commitsText(commits)}</span>
          {commits.lastAt && <small>last {relativeTime(commits.lastAt)}</small>}
        </li>
      )}
      {built && (
        <li>
          <span className="dev-k">Builds</span>
          <span className={built.failing ? 'dev-bad' : undefined}>
            {built.failing && <Glyph name="x-circle" size={13} />}
            {built.text}
          </span>
        </li>
      )}
    </ul>
  );
}

export function Development({
  ticket,
  trackerLinks,
  development,
  sourceName,
  loading,
  lead,
}: DevelopmentProps) {
  const headingId = useId();
  const pulls = development
    ? developmentPulls(development, sourceName)
    : ticketPulls(ticket, trackerLinks);
  const branches = development?.branches ?? [];
  const unavailable = development?.availability === 'unavailable';
  const hasActivity = Boolean(development?.commits ?? development?.builds);
  const empty = pulls.length === 0 && branches.length === 0 && !hasActivity;
  return (
    <section className={lead ? 'tk-sec lead' : 'tk-sec'} aria-labelledby={headingId}>
      <h4 id={headingId}>Development</h4>
      {pulls.length > 0 && (
        <ul className="pr-list" aria-label="Pull requests">
          {pulls.map((entry) => (
            <PullLink key={entry.url} entry={entry} />
          ))}
        </ul>
      )}
      {branches.length > 0 && <BranchList branches={branches} />}
      {development && <Activity development={development} />}
      {unavailable && (
        <p className="tk-quiet dev-note">Development info unavailable from {sourceName}.</p>
      )}
      {empty && !unavailable && loading && <Skeleton label="Loading development info" rows={1} />}
      {empty && !unavailable && !loading && (
        <p className="tk-quiet">No pull request is linked to this ticket yet.</p>
      )}
    </section>
  );
}
