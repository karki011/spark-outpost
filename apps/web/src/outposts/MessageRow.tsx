import type { ReactNode } from 'react';
import type { OutpostPost } from '@spark-outpost/contracts';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { requestNote } from '../chat/outpost/RequestHeader.tsx';
import { MoveIcon, PinIcon, SparkleIcon } from '../ui/icons.tsx';
import { MemberFace } from './MemberFace.tsx';
import { PostText } from './PostText.tsx';
import { attachedLabel, postTime, senderName } from './post-text.ts';

interface MessageRowProps {
  post: OutpostPost;
  anchor?: string | undefined;
  targets?: readonly string[] | undefined;
  body: string;
  createdAt: string;
  children?: ReactNode;
}

function SenderFace({ post }: { post: OutpostPost }) {
  if (post.fromConversationId) return <MemberFace chatId={post.fromConversationId} size="strip" />;
  if (post.fromSpark) {
    return (
      <span className="op-avatar spark" aria-hidden="true">
        <SparkleIcon />
      </span>
    );
  }
  return (
    <span className="op-avatar you" aria-hidden="true">
      {post.fromUser ? 'Y' : '?'}
    </span>
  );
}

export function MessageRow({ post, anchor, targets, body, createdAt, children }: MessageRowProps) {
  const note = requestNote(post);
  const what = post.kind === 'note' ? 'note' : 'request';
  return (
    <li id={anchor} className="op-post op-msg" data-post={post.id}>
      <SenderFace post={post} />
      <div className="op-msg-body">
        <div className="op-post-head">
          <b>{senderName(post)}</b>
          {note && <span className="op-nfy">{note}</span>}
          {targets && targets.length > 0 && (
            <span className="op-to">
              <MoveIcon />
              <span className="sr-only">to</span>
              {targets.map((handle) => `@${handle}`).join(', ')}
            </span>
          )}
          <time dateTime={createdAt}>{postTime(createdAt)}</time>
          {post.kind === 'note' && <span className="op-kind">note</span>}
          {post.pinnedAt && (
            <span className="op-kind">
              <PinIcon />
              Pinned
            </span>
          )}
        </div>
        <PostText text={body} what={what} markdown />
        {post.files > 0 && (
          <p className="op-attached">
            <FileIcon />
            {attachedLabel(post.files)}
          </p>
        )}
        {children && <div className="op-cards">{children}</div>}
      </div>
    </li>
  );
}
