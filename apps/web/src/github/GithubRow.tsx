import type { GithubInboxItem } from '@spark-outpost/contracts';
import { initials } from '../calendar/month-model.ts';
import { webLink } from '../outposts/post-text.ts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { ageLabel, botsState, isFresh, prState } from './github-model.ts';
import { NewCommitsPill, StatePill, TicketChip } from './StatePill.tsx';

interface GithubRowProps {
  item: GithubInboxItem;
  selected: boolean;
  nested?: boolean;
  now: number;
  onOpen: (item: GithubInboxItem) => void;
  onOpenChat: (conversationId: string) => void;
}

function RowAction({ item, onOpenChat }: Pick<GithubRowProps, 'item' | 'onOpenChat'>) {
  const conversationId = item.conversationId;
  if (conversationId) {
    return (
      <button
        type="button"
        className="btn line sm gh-act"
        title="Open chat"
        onClick={() => onOpenChat(conversationId)}
      >
        <Glyph name="chat" size={13} />
        <span className="gh-act-label">Open chat</span>
      </button>
    );
  }
  const href = webLink(item.url);
  if (!href) return null;
  return (
    <a
      className="btn line sm gh-act"
      href={href}
      title="Open on GitHub"
      target="_blank"
      rel="noreferrer"
    >
      <Glyph name="pr" size={13} />
      <span className="gh-act-label">Open on GitHub</span>
    </a>
  );
}

export function GithubRow({
  item,
  selected,
  nested = false,
  now,
  onOpen,
  onOpenChat,
}: GithubRowProps) {
  const state = prState(item);
  const classes = ['gh-row', nested ? 'nested' : null, item.unseen ? 'unseen' : null];
  return (
    <li className={classes.filter(Boolean).join(' ')} data-selected={selected || undefined}>
      <button
        type="button"
        className="gh-main"
        data-id={item.id}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(item)}
      >
        <i className="gh-dot" aria-hidden="true" data-on={isFresh(item) || undefined} />
        <span className="gh-av" aria-hidden="true">
          {initials(item.author) || '?'}
        </span>
        <span className="gh-text">
          <span className="gh-title">
            {item.title}
            {item.unseen && <span className="sr-only">, new</span>}
            <span className="sr-only">, by {item.author}</span>
          </span>
          <span className="gh-meta">
            {item.ticket && <TicketChip ticketKey={item.ticket.key} />}
            {item.updatedSinceSeen && <NewCommitsPill />}
            {state && <StatePill state={state} />}
            <time className="gh-age" dateTime={item.updatedAt}>
              {ageLabel(item.updatedAt, now)}
            </time>
          </span>
        </span>
      </button>
      <RowAction item={item} onOpenChat={onOpenChat} />
    </li>
  );
}

interface BotsRowProps {
  items: GithubInboxItem[];
  expanded: boolean;
  now: number;
  onToggle: () => void;
}

export function BotsRow({ items, expanded, now, onToggle }: BotsRowProps) {
  const state = botsState(items);
  const newest = items.reduce(
    (last, item) => (item.updatedAt > last ? item.updatedAt : last),
    items[0]!.updatedAt,
  );
  const fresh = items.some(isFresh);
  return (
    <li className="gh-row bots">
      <button type="button" className="gh-main" aria-expanded={expanded} onClick={onToggle}>
        <i className="gh-dot" aria-hidden="true" data-on={fresh || undefined} />
        <span className="gh-av count" aria-hidden="true">
          {items.length}
        </span>
        <span className="gh-text">
          <span className="gh-title">
            Dependency updates
            <span className="sr-only">, {items.length} pull requests</span>
          </span>
          <span className="gh-meta">
            {state && (
              <StatePill state={state} label={state === 'passing' ? 'All passing' : undefined} />
            )}
            <time className="gh-age" dateTime={newest}>
              {ageLabel(newest, now)}
            </time>
          </span>
        </span>
      </button>
    </li>
  );
}
