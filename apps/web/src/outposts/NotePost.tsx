import type { OutpostPost } from '@spark-outpost/contracts';
import { PostText } from './PostText.tsx';
import { postTime, senderName } from './post-text.ts';

export function NotePost({ post }: { post: OutpostPost }) {
  return (
    <li className="op-post" data-post={post.id}>
      <div className="op-post-head">
        <b>{senderName(post)}</b>
        <span className="op-kind">note</span>
        <time dateTime={post.createdAt}>{postTime(post.createdAt)}</time>
      </div>
      <PostText text={post.body} what="note" />
    </li>
  );
}
