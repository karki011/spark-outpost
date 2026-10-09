import type { OutpostPost } from '@spark-outpost/contracts';
import { ChatFace } from '../brand/ChatFace.tsx';
import { PostText } from './PostText.tsx';
import { postAnchor, postTime, senderName } from './post-text.ts';

export function NotePost({ post }: { post: OutpostPost }) {
  return (
    <li id={postAnchor(post.id)} className="op-post" data-post={post.id}>
      <div className="op-post-head">
        {post.fromConversationId && <ChatFace chatId={post.fromConversationId} size="post" />}
        <b>{senderName(post)}</b>
        <span className="op-kind">note</span>
        <time dateTime={post.createdAt}>{postTime(post.createdAt)}</time>
      </div>
      <PostText text={post.body} what="note" />
    </li>
  );
}
