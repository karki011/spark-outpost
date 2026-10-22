import '../chat/thread.css';
import { Fragment, useLayoutEffect, useState, type ReactNode } from 'react';
import type { BatchLine, ThreadItem } from '@spark-outpost/contracts';
import { useStickToBottom } from '../chat/use-stick-to-bottom.ts';
import { scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { ConfirmButton } from './ConfirmButton.tsx';
import { MessageRow } from './MessageRow.tsx';
import { NoticeLine } from './NoticeLine.tsx';
import { RequestCard, type CardHandlers } from './RequestCard.tsx';
import { dayKey, dayLabel } from './day-label.ts';
import { announcements } from './post-announce.ts';
import { canCancel, postAnchor } from './post-text.ts';
import type { ThreadCard } from './thread-cards.ts';

interface PostListProps extends CardHandlers {
  items: readonly ThreadItem[];
  cards: ReadonlyMap<string, ThreadCard>;
  selectedId: string | null;
  jumpTo?: string | null | undefined;
  approvalChats?: ReadonlySet<string> | undefined;
  storyTags?: ReadonlyMap<string, string> | undefined;
  empty: ReactNode;
  after?: ReactNode;
}

interface Heard {
  items: readonly ThreadItem[];
  lines: readonly string[];
}

function useAnnouncements(items: readonly ThreadItem[]): readonly string[] {
  const [heard, setHeard] = useState<Heard>({ items, lines: [] });
  if (heard.items === items) return heard.lines;
  const fresh = announcements(heard.items, items);
  const lines = fresh.length > 0 ? fresh : heard.lines;
  setHeard({ items, lines });
  return lines;
}

function CancelAll({
  lines,
  onCancel,
}: {
  lines: readonly BatchLine[];
  onCancel: (postId: string) => void;
}) {
  const open = lines.filter((line) => canCancel(line.post));
  if (open.length < 2) return null;
  return (
    <div className="op-card-foot">
      <ConfirmButton
        label="Cancel all"
        what={`${open.length} open requests`}
        onConfirm={() => open.forEach((line) => onCancel(line.post.id))}
      />
    </div>
  );
}

function itemTime(item: ThreadItem): string {
  return item.kind === 'batch' ? item.createdAt : item.post.createdAt;
}

function itemKey(item: ThreadItem): string {
  return item.kind === 'batch' ? item.batchId : item.post.id;
}

export function PostList({
  items,
  cards,
  selectedId,
  jumpTo,
  approvalChats,
  storyTags,
  empty,
  after,
  ...handlers
}: PostListProps) {
  const { scrollerRef, away, unfollow, jumpToLatest } = useStickToBottom();
  const lines = useAnnouncements(items);
  useLayoutEffect(() => {
    if (!jumpTo) return;
    unfollow();
    scrollToAnchor(postAnchor(jumpTo));
  }, [jumpTo, unfollow]);

  const cardFor = (postId: string) => {
    const card = cards.get(postId);
    if (!card) return null;
    return (
      <RequestCard
        key={postId}
        card={card}
        selected={postId === selectedId}
        answerable={!approvalChats?.has(card.post.toConversationId ?? '')}
        story={storyTags?.get(postId)}
        {...handlers}
      />
    );
  };

  const row = (item: ThreadItem) => {
    if (item.kind === 'notice') return <NoticeLine post={item.post} />;
    if (item.kind === 'note') {
      return (
        <MessageRow
          post={item.post}
          anchor={postAnchor(item.post.id)}
          body={item.post.body}
          createdAt={item.post.createdAt}
        />
      );
    }
    if (item.kind === 'request') {
      return (
        <MessageRow
          post={item.post}
          targets={[item.post.toHandle ?? 'chat']}
          body={item.post.body}
          createdAt={item.post.createdAt}
        >
          {cardFor(item.post.id)}
        </MessageRow>
      );
    }
    const first = item.lines[0]?.post;
    if (!first) return null;
    return (
      <MessageRow
        post={first}
        targets={item.lines.map((line) => line.handle)}
        body={item.body}
        createdAt={item.createdAt}
      >
        {item.lines.map((line) => cardFor(line.post.id))}
        <CancelAll lines={item.lines} onCancel={handlers.onCancel} />
      </MessageRow>
    );
  };

  return (
    <div className="thread-wrap">
      <div className="thread op-thread" ref={scrollerRef}>
        <div className="col">
          {items.length === 0 && empty}
          <ol className="op-posts" aria-label="Outpost thread">
            {items.map((item, index) => {
              const day = dayKey(itemTime(item));
              const newDay = index === 0 || dayKey(itemTime(items[index - 1]!)) !== day;
              return (
                <Fragment key={itemKey(item)}>
                  {newDay && day !== '' && (
                    <li className="op-day" aria-hidden="true">
                      <span>{dayLabel(itemTime(item))}</span>
                    </li>
                  )}
                  {row(item)}
                </Fragment>
              );
            })}
          </ol>
          {after}
        </div>
      </div>
      <div className="sr-only" role="log" aria-live="polite" aria-label="Outpost updates">
        {lines.map((line, index) => (
          <p key={`${index}:${line}`}>{line}</p>
        ))}
      </div>
      <button type="button" className={away ? 'jump show' : 'jump'} onClick={jumpToLatest}>
        <ArrowDownIcon />
        Jump to latest
      </button>
    </div>
  );
}
