import './outpost-batch.css';
import type { BatchLine, ThreadItem } from '@spark-outpost/contracts';
import { MoveIcon } from '../ui/icons.tsx';
import { PostText } from './PostText.tsx';
import {
  ReceiverFace,
  RequestOutcome,
  RequestStateChip,
  type RequestHandlers,
} from './RequestOutcome.tsx';
import { canCancel, postAnchor, postTime, receiverName, senderName } from './post-text.ts';

interface BatchPostProps extends RequestHandlers {
  item: Extract<ThreadItem, { kind: 'batch' }>;
  answeringId: string | null;
  approvalChats?: ReadonlySet<string> | undefined;
  activity?: ReadonlyMap<string, string> | undefined;
}

function Receiver({ line }: { line: BatchLine }) {
  return (
    <span className="op-batch-to">
      <ReceiverFace post={line.post} />
      <b>{receiverName(line.post)}</b>
    </span>
  );
}

export function BatchPost({
  item,
  answeringId,
  approvalChats,
  activity,
  ...handlers
}: BatchPostProps) {
  const { lines } = item;
  const first = lines[0]?.post;
  const open = lines.filter((line) => canCancel(line.post));
  const answering = lines.some((line) => line.post.id === answeringId);
  if (!first) return null;
  return (
    <li className={answering ? 'op-post answering' : 'op-post'} data-post={first.id}>
      <div className="op-post-head">
        <b>{senderName(first)}</b>
        <span className="op-to">
          <MoveIcon />
          <span className="sr-only">to</span>
        </span>
        {lines.map((line) => (
          <Receiver key={line.post.id} line={line} />
        ))}
        <time dateTime={item.createdAt}>{postTime(item.createdAt)}</time>
      </div>
      <PostText text={item.body} what="request" typed />
      <ul className="op-each-list" aria-label="Each chat this asked">
        {lines.map((line) => {
          const chatId = line.post.toConversationId ?? '';
          return (
            <li
              key={line.post.id}
              id={postAnchor(line.post.id)}
              className="op-each"
              aria-label={receiverName(line.post)}
            >
              <div className="op-post-head">
                <Receiver line={line} />
                <RequestStateChip state={line.post.state ?? 'sent'} />
              </div>
              <RequestOutcome
                post={line.post}
                answering={line.post.id === answeringId}
                answerable={!approvalChats?.has(chatId)}
                activity={activity?.get(chatId)}
                inBatch
                {...handlers}
              />
            </li>
          );
        })}
      </ul>
      {open.length > 1 && (
        <div className="op-actions">
          <button
            type="button"
            className="op-link"
            onClick={() => open.forEach((line) => handlers.onCancel(line.post.id))}
          >
            Cancel all
          </button>
        </div>
      )}
    </li>
  );
}
