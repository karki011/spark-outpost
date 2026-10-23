import type { OutpostPost } from '@spark-outpost/contracts';
import { requestNote } from '../chat/outpost/RequestHeader.tsx';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { ConfirmButton } from './ConfirmButton.tsx';
import { MemberFace } from './MemberFace.tsx';
import { StatusPill } from './StatusPill.tsx';
import {
  canCancel,
  postAnchor,
  receiverName,
  requestFaceState,
  senderName,
  webLink,
} from './post-text.ts';
import type { ThreadCard } from './thread-cards.ts';

export interface CardHandlers {
  onOpenThread: (postId: string) => void;
  onAnswer: (postId: string) => void;
  onCancel: (postId: string) => void;
  onStartNow?: ((postId: string) => void) | undefined;
}

interface RequestCardProps extends CardHandlers {
  card: ThreadCard;
  selected: boolean;
  answering?: boolean | undefined;
  answerable: boolean;
  story?: string | null | undefined;
}

export function provenance(post: OutpostPost): string | null {
  const note = requestNote(post);
  if (note === null) return null;
  return `Written by ${senderName(post)}, ${note}. It is not your request to push or open a pull request.`;
}

interface MetaLine {
  lead: string;
  facts: string | null;
  branch: string | null;
}

export function metaLine(card: ThreadCard): MetaLine | null {
  const { branch, facts } = card.git;
  if (card.summary) {
    return { lead: card.summary, facts: facts.length > 0 ? facts.join(' · ') : null, branch };
  }
  const git = [branch, ...facts].filter((part): part is string => part !== null);
  return git.length > 0 ? { lead: git.join(' · '), facts: null, branch: null } : null;
}

function CardMeta({ meta }: { meta: MetaLine }) {
  return (
    <p className="op-card-meta">
      <span className="op-card-lead">{meta.lead}</span>
      {meta.facts && (
        <span className="op-card-facts" title={meta.branch ?? undefined}>
          {' · '}
          {meta.facts}
        </span>
      )}
    </p>
  );
}

export function RequestCard({
  card,
  selected,
  answering = false,
  answerable,
  story,
  onOpenThread,
  onAnswer,
  onCancel,
  onStartNow,
}: RequestCardProps) {
  const { post, status } = card;
  const to = receiverName(post);
  const chatId = post.toConversationId;
  const pullUrl = card.pull ? webLink(card.pull.url) : undefined;
  const from = provenance(post);
  const meta = metaLine(card);
  const classes = ['op-card', status, selected ? 'selected' : ''].filter(Boolean).join(' ');
  return (
    <article
      id={postAnchor(post.id)}
      className={classes}
      data-post={post.id}
      aria-label={[`${to}: ${card.title}`, card.pill, from].filter(Boolean).join('. ')}
      title={from ?? undefined}
    >
      <div className="op-card-top">
        {chatId && (
          <MemberFace chatId={chatId} state={requestFaceState(post.state ?? 'sent')} size="row" />
        )}
        <b>{to}</b>
        <span className="op-card-title">{card.title}</span>
        <StatusPill status={status} label={card.pill} />
      </div>
      {meta && <CardMeta meta={meta} />}
      <div className="op-card-foot">
        {post.state === 'needs_you' && chatId && answerable && (
          <button
            type="button"
            className="btn sm primary"
            aria-label={`Answer ${to}`}
            aria-pressed={answering}
            onClick={() => onAnswer(post.id)}
          >
            Answer
          </button>
        )}
        {pullUrl && (
          <a className="btn sm primary" href={pullUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon />
            Review PR
          </a>
        )}
        {chatId && (
          <button
            type="button"
            className="btn sm line"
            aria-label={`Open the thread with ${to}`}
            aria-expanded={selected}
            onClick={() => onOpenThread(post.id)}
          >
            Open
          </button>
        )}
        {onStartNow && post.held && (
          <button
            type="button"
            className="btn sm line"
            aria-label={`Start the request to ${to} anyway`}
            onClick={() => onStartNow(post.id)}
          >
            Start anyway
          </button>
        )}
        {canCancel(post) && (
          <ConfirmButton
            label={post.state === 'working' ? 'Stop' : 'Cancel'}
            what={`the request to ${to}`}
            onConfirm={() => onCancel(post.id)}
          />
        )}
        {(post.guest || story) && (
          <span className="op-card-tags">
            {post.guest && <span className="op-kind">guest</span>}
            {story && <span className="op-kind">{story}</span>}
          </span>
        )}
      </div>
    </article>
  );
}
