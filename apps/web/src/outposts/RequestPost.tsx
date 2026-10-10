import type { OutpostAnswer, OutpostPost, RequestState } from '@spark-outpost/contracts';
import {
  AskIcon,
  BranchIcon,
  CheckIcon,
  ExternalLinkIcon,
  InfoIcon,
  MoveIcon,
} from '../ui/icons.tsx';
import './outpost-answer.css';
import { AskedRound } from './AskedRound.tsx';
import { MemberFace } from './MemberFace.tsx';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { PostText } from './PostText.tsx';
import { splitQuestion } from './answer-text.ts';
import {
  STATE_LABELS,
  attachedLabel,
  requestFaceState,
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
  answerable: boolean;
  onAnswer: (post: OutpostPost) => void;
  onCancel: (postId: string) => void;
  onStartNow?: ((postId: string) => void) | undefined;
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

export function RequestPost({
  post,
  answering,
  answerable,
  onAnswer,
  onCancel,
  onStartNow,
  onOpenChat,
}: RequestPostProps) {
  const state = post.state ?? 'sent';
  const to = receiverName(post);
  const chatId = post.toConversationId;
  const receiver = chatId && (
    <MemberFace chatId={chatId} state={requestFaceState(state)} size="post" />
  );
  const waiting = state === 'needs_you';
  const replyText = waiting ? splitQuestion(post.answer?.text ?? '').said : post.answer?.text;
  return (
    <li
      id={postAnchor(post.id)}
      className={answering ? 'op-post answering' : 'op-post'}
      data-post={post.id}
    >
      <div className="op-post-head">
        {post.fromConversationId && <MemberFace chatId={post.fromConversationId} size="post" />}
        <b>{senderName(post)}</b>
        {!post.fromUser && <span className="op-kind">not from you</span>}
        <span className="op-to">
          <MoveIcon />
          <span className="sr-only">to</span>
        </span>
        {receiver}
        <b>{to}</b>
        {post.guest && <span className="op-kind">guest</span>}
        <span className={`op-state ${state}`}>
          <StateIcon state={state} />
          {STATE_LABELS[state]}
        </span>
        <time dateTime={post.createdAt}>{postTime(post.createdAt)}</time>
      </div>
      <PostText text={post.body} what="request" />
      {post.files > 0 && (
        <p className="op-attached">
          <FileIcon />
          {attachedLabel(post.files)}
        </p>
      )}
      {post.reason && (
        <p className={state === 'failed' ? 'op-reason bad' : 'op-reason'}>{post.reason}</p>
      )}
      {post.exchanges.map((exchange, index) => (
        <AskedRound key={index} exchange={exchange} chatId={chatId} handle={to} />
      ))}
      {post.answer && (
        <div className="op-reply">
          <div className="op-post-head">
            {receiver}
            <b>{to}</b>
            <span className="op-mood">{waiting ? 'is waiting for you' : 'answered'}</span>
          </div>
          {replyText && <PostText text={replyText} what="answer" markdown />}
          <AnswerResults answer={post.answer} />
        </div>
      )}
      <div className="op-actions">
        {state === 'needs_you' && chatId && answerable && (
          <button
            type="button"
            className="op-link"
            aria-pressed={answering}
            onClick={() => onAnswer(post)}
          >
            Answer
          </button>
        )}
        {onStartNow && post.held && (
          <button
            type="button"
            className="op-link"
            aria-label={`Start the request to ${to} anyway`}
            onClick={() => onStartNow(post.id)}
          >
            Start anyway
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
