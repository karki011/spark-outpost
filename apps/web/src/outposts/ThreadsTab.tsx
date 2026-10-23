import { useId } from 'react';
import { MemberFace } from './MemberFace.tsx';
import { provenance } from './RequestCard.tsx';
import { StatusPill } from './StatusPill.tsx';
import { receiverName, requestFaceState } from './post-text.ts';
import { GROUP_LABELS, type ThreadStatus } from './request-status.ts';
import { groupCards, type ThreadCard } from './thread-cards.ts';

interface ThreadsTabProps {
  cards: readonly ThreadCard[];
  selectedId: string | null;
  onOpenThread: (postId: string) => void;
}

export function threadRowId(postId: string): string {
  return `op-thread-row-${postId}`;
}

function RowText({ card }: { card: ThreadCard }) {
  const chatId = card.post.toConversationId;
  const from = provenance(card.post);
  return (
    <>
      {chatId && (
        <MemberFace
          chatId={chatId}
          state={requestFaceState(card.post.state ?? 'sent')}
          size="row"
        />
      )}
      <span className="op-trow-text">
        <b>{card.title}</b>
        <span className="op-trow-sub">
          {receiverName(card.post)}
          {card.pull?.number ? ` · PR #${card.pull.number}` : ''}
        </span>
        {from && <span className="sr-only">{from}</span>}
      </span>
      <StatusPill status={card.status} label={card.pill} />
    </>
  );
}

function ThreadRow({
  card,
  selected,
  onOpenThread,
}: {
  card: ThreadCard;
  selected: boolean;
  onOpenThread: (postId: string) => void;
}) {
  const from = provenance(card.post) ?? undefined;
  if (card.post.toConversationId === null) {
    return (
      <div className="op-trow gone" title={from}>
        <RowText card={card} />
      </div>
    );
  }
  return (
    <button
      id={threadRowId(card.post.id)}
      type="button"
      className="op-trow"
      aria-current={selected ? 'true' : undefined}
      title={from}
      onClick={() => onOpenThread(card.post.id)}
    >
      <RowText card={card} />
    </button>
  );
}

function Group({
  status,
  cards,
  selectedId,
  onOpenThread,
}: {
  status: ThreadStatus;
  cards: readonly ThreadCard[];
  selectedId: string | null;
  onOpenThread: (postId: string) => void;
}) {
  const headingId = useId();
  return (
    <section className={`op-group ${status}`} aria-labelledby={headingId}>
      <h3 id={headingId}>
        {GROUP_LABELS[status]}
        <span className="op-group-count">{cards.length}</span>
      </h3>
      <ul>
        {cards.map((card) => (
          <li key={card.post.id}>
            <ThreadRow
              card={card}
              selected={card.post.id === selectedId}
              onOpenThread={onOpenThread}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ThreadsTab({ cards, selectedId, onOpenThread }: ThreadsTabProps) {
  const groups = groupCards(cards);
  if (groups.length === 0) {
    return <p className="op-pane-empty">No threads yet. Ask a chat with @ to start one.</p>;
  }
  return (
    <div className="op-groups">
      {groups.map((group) => (
        <Group
          key={group.status}
          status={group.status}
          cards={group.cards}
          selectedId={selectedId}
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  );
}
