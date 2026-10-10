import type { OutpostPost } from '@spark-outpost/contracts';
import { MoveIcon } from '../ui/icons.tsx';
import { MemberFace } from './MemberFace.tsx';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { PostText } from './PostText.tsx';
import {
  ReceiverFace,
  RequestOutcome,
  RequestStateChip,
  type RequestHandlers,
} from './RequestOutcome.tsx';
import { attachedLabel, postAnchor, postTime, receiverName, senderName } from './post-text.ts';

interface RequestPostProps extends RequestHandlers {
  post: OutpostPost;
  answering: boolean;
  answerable: boolean;
  activity?: string | undefined;
}

export function RequestPost({ post, answering, ...outcome }: RequestPostProps) {
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
        <ReceiverFace post={post} />
        <b>{receiverName(post)}</b>
        {post.guest && <span className="op-kind">guest</span>}
        <RequestStateChip state={post.state ?? 'sent'} />
        <time dateTime={post.createdAt}>{postTime(post.createdAt)}</time>
      </div>
      <PostText text={post.body} what="request" />
      {post.files > 0 && (
        <p className="op-attached">
          <FileIcon />
          {attachedLabel(post.files)}
        </p>
      )}
      <RequestOutcome post={post} answering={answering} {...outcome} />
    </li>
  );
}
