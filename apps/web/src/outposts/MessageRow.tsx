import { memo, type ReactNode } from 'react';
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
  onPin?: ((postId: string, pinned: boolean) => void) | undefined;
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

function MessageRowView({
  post,
  anchor,
  targets,
  body,
  createdAt,
  onPin,
  children,
}: MessageRowProps) {
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
          {onPin && post.kind === 'note' && (
            <button
              type="button"
              className="btn sm line op-pin-btn"
              aria-pressed={post.pinnedAt !== null}
              aria-label={post.pinnedAt ? 'Unpin note' : 'Pin note'}
              onClick={() => onPin(post.id, post.pinnedAt === null)}
            >
              {post.pinnedAt ? 'Unpin' : 'Pin'}
            </button>
          )}
        </div>
        <PostText text={body} what={what} />
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

function sameTargets(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((handle, index) => handle === b[index]);
}

export const MessageRow = memo(
  MessageRowView,
  (before, after) =>
    before.children === undefined &&
    after.children === undefined &&
    before.post === after.post &&
    before.anchor === after.anchor &&
    before.body === after.body &&
    before.onPin === after.onPin &&
    before.createdAt === after.createdAt &&
    sameTargets(before.targets, after.targets),
);
