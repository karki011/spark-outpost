import type { OutpostAnswer, OutpostPost, RequestState } from '@spark-outpost/contracts';
import { AskIcon, BranchIcon, CheckIcon, ExternalLinkIcon, InfoIcon } from '../ui/icons.tsx';
import './outpost-answer.css';
import { AskedRound } from './AskedRound.tsx';
import { MemberFace } from './MemberFace.tsx';
import { PostText } from './PostText.tsx';
import { splitQuestion } from './answer-text.ts';
import {
  STATE_LABELS,
  canCancel,
  filesLabel,
  pullRequestLabel,
  receiverName,
  requestFaceState,
  webLink,
} from './post-text.ts';

export interface RequestHandlers {
  onAnswer: (post: OutpostPost) => void;
  onCancel: (postId: string) => void;
  onStartNow?: ((postId: string) => void) | undefined;
  onOpenChat: (conversationId: string) => void;
}

interface RequestOutcomeProps extends RequestHandlers {
  post: OutpostPost;
  answering: boolean;
  answerable: boolean;
  activity?: string | undefined;
}

function StateIcon({ state }: { state: RequestState }) {
  if (state === 'working') return <i className="op-orb" aria-hidden="true" />;
  if (state === 'needs_you') return <AskIcon />;
  if (state === 'answered') return <CheckIcon className="op-ok" />;
  if (state === 'failed') return <InfoIcon />;
  return null;
}

export function RequestStateChip({ state }: { state: RequestState }) {
  return (
    <span className={`op-state ${state}`}>
      <StateIcon state={state} />
      {STATE_LABELS[state]}
    </span>
  );
}

export function ReceiverFace({ post }: { post: OutpostPost }) {
  const chatId = post.toConversationId;
  if (!chatId) return null;
  return <MemberFace chatId={chatId} state={requestFaceState(post.state ?? 'sent')} size="post" />;
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

export function RequestOutcome({
  post,
  answering,
  answerable,
  activity,
  onAnswer,
  onCancel,
  onStartNow,
  onOpenChat,
}: RequestOutcomeProps) {
  const state = post.state ?? 'sent';
  const to = receiverName(post);
  const chatId = post.toConversationId;
  const waiting = state === 'needs_you';
  const replyText = waiting ? splitQuestion(post.answer?.text ?? '').said : post.answer?.text;
  return (
    <>
      {state === 'working' && activity && <p className="op-activity">{activity}</p>}
      {post.reason && (
        <p className={state === 'failed' ? 'op-reason bad' : 'op-reason'}>{post.reason}</p>
      )}
      {post.exchanges.map((exchange, index) => (
        <AskedRound key={index} exchange={exchange} chatId={chatId} handle={to} />
      ))}
      {post.answer && (
        <div className="op-reply">
          <div className="op-post-head">
            <ReceiverFace post={post} />
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
    </>
  );
}
