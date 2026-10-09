import type { OutpostAnswer, OutpostPost, RequestState } from '@spark-outpost/contracts';
import {
  AskIcon,
  BranchIcon,
  CheckIcon,
  ExternalLinkIcon,
  InfoIcon,
  MoveIcon,
} from '../ui/icons.tsx';
import { PostText } from './PostText.tsx';
import {
  STATE_LABELS,
  canCancel,
  filesLabel,
  postAnchor,
  postTime,
  pullRequestLabel,
  receiverName,
  senderName,
  webLink,
} from './post-text.ts';

interface RequestPostProps {
  post: OutpostPost;
  answering: boolean;
  onAnswer: (post: OutpostPost) => void;
  onCancel: (postId: string) => void;
  onOpenChat: (conversationId: string) => void;
}

function StateIcon({ state }: { state: RequestState }) {
  if (state === 'working') return <i className="op-orb" aria-hidden="true" />;
  if (state === 'needs_you') return <AskIcon />;
  if (state === 'answered') return <CheckIcon className="op-ok" />;
  if (state === 'failed') return <InfoIcon />;
  return null;
}

function AnswerResults({ answer }: { answer: OutpostAnswer }) {
  const links = answer.pullRequests.filter((url) => webLink(url));
  if (!answer.branch && answer.changes.length === 0 && links.length === 0) return null;
  return (
    <div className="op-results">
      {answer.branch && (
        <span className="op-res mono">
          <BranchIcon />
          {answer.branch}
        </span>
      )}
      {links.map((url) => (
        <a key={url} className="op-res" href={webLink(url)} target="_blank" rel="noreferrer">
          <ExternalLinkIcon />
          {pullRequestLabel(url)}
        </a>
      ))}
      {answer.changes.length > 0 && (
        <details className="op-files">
          <summary className="op-res">{filesLabel(answer.changes.length)}</summary>
          <ul>
            {answer.changes.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RequestPost({ post, answering, onAnswer, onCancel, onOpenChat }: RequestPostProps) {
  const state = post.state ?? 'sent';
  const to = receiverName(post);
  const chatId = post.toConversationId;
  return (
    <li
      id={postAnchor(post.id)}
      className={answering ? 'op-post answering' : 'op-post'}
      data-post={post.id}
    >
      <div className="op-post-head">
        <b>{senderName(post)}</b>
        <span className="op-to">
          <MoveIcon />
          <span className="sr-only">to</span>
        </span>
        <b>{to}</b>
        {post.guest && <span className="op-kind">guest</span>}
        <span className={`op-state ${state}`}>
          <StateIcon state={state} />
          {STATE_LABELS[state]}
        </span>
        <time dateTime={post.createdAt}>{postTime(post.createdAt)}</time>
      </div>
      <PostText text={post.body} what="request" />
      {post.reason && (
        <p className={state === 'failed' ? 'op-reason bad' : 'op-reason'}>{post.reason}</p>
      )}
      {post.answer && (
        <div className="op-reply">
          <div className="op-post-head">
            <b>{to}</b>
            <span className="op-mood">
              {state === 'needs_you' ? 'is waiting for you' : 'answered'}
            </span>
          </div>
          <PostText text={post.answer.text} what="answer" />
          <AnswerResults answer={post.answer} />
        </div>
      )}
      <div className="op-actions">
        {state === 'needs_you' && chatId && (
          <button
            type="button"
            className="op-link"
            aria-pressed={answering}
            onClick={() => onAnswer(post)}
          >
            Answer
          </button>
        )}
        {canCancel(post) && (
          <button
            type="button"
            className="op-link"
            aria-label={`Cancel request to ${to}`}
            onClick={() => onCancel(post.id)}
          >
            Cancel
          </button>
        )}
        {chatId && (
          <button
            type="button"
            className="op-link"
            aria-label={`Open ${to} in chat`}
            onClick={() => onOpenChat(chatId)}
          >
            Open in chat
          </button>
        )}
      </div>
    </li>
  );
}
