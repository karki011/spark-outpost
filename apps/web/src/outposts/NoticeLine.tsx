import type { OutpostPost } from '@spark-outpost/contracts';

export function NoticeLine({ post }: { post: OutpostPost }) {
  return (
    <li className="op-notice" data-post={post.id}>
      <span>{post.body}</span>
    </li>
  );
}
