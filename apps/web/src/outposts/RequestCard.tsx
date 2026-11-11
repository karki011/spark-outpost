import { memo } from 'react';
import type { OutpostPost } from '@spark-outpost/contracts';
import { requestNote } from '../chat/outpost/RequestHeader.tsx';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { ConfirmButton } from './ConfirmButton.tsx';
import { MemberFace } from './MemberFace.tsx';
import { StatusPill } from './StatusPill.tsx';
import {
  canCancel,
  canRetry,
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
  onRetry?: ((postId: string) => void) | undefined;
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

function CardMeta({ card }: { card: ThreadCard }) {
  const { branch, facts } = card.git;
  const git = facts.join(' · ');
  return (
    <>
      {card.summary && (
        <p className="op-card-meta">
          <span className="op-card-lead">{card.summary}</span>
        </p>
      )}
      {(branch !== null || git !== '') && (
        <p className="op-card-git">
          {branch !== null && (
            <span className="op-card-branch" title={branch}>
              {branch}
            </span>
          )}
          {git !== '' && (
            <span className="op-card-facts">{branch !== null ? ` · ${git}` : git}</span>
          )}
        </p>
      )}
    </>
  );
}

export const RequestCard = memo(function RequestCard({
  card,
  selected,
  answering = false,
  answerable,
  story,
  onOpenThread,
  onAnswer,
  onCancel,
  onStartNow,
  onRetry,
}: RequestCardProps) {
  const { post, status } = card;
  const to = receiverName(post);
  const chatId = post.toConversationId;
  const pullUrl = card.pull ? webLink(card.pull.url) : undefined;
  const from = provenance(post);
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
      <CardMeta card={card} />
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
        {onRetry && canRetry(post) && (
          <button
            type="button"
            className="btn sm line"
            aria-label={`Retry the request to ${to}`}
            onClick={() => onRetry(post.id)}
          >
            Retry
          </button>
        )}
        {canCancel(post) && (
          <ConfirmButton
            label={post.state === 'working' ? 'Stop' : 'Cancel'}
            what={`the request to ${to}`}
            onConfirm={() => onCancel(post.id)}
          />
        )}
        {story && (
          <span className="op-card-tags">
            <span className="op-kind">{story}</span>
          </span>
        )}
      </div>
    </article>
  );
});
