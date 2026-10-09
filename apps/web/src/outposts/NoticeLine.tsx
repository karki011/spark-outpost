import type { OutpostPost } from '@spark-outpost/contracts';
import { ChatFace } from '../brand/ChatFace.tsx';

export function NoticeLine({ post }: { post: OutpostPost }) {
  const { intro } = post;
  return (
    <li className="op-notice" data-post={post.id}>
      {intro ? (
        <span className="op-intro">
          <span className="op-intro-line">
            <ChatFace chatId={intro.conversationId} size="row" />
            <span>{post.body}</span>
          </span>
          {intro.task && <span className="op-intro-task">{intro.task}</span>}
        </span>
      ) : (
        <span>{post.body}</span>
      )}
    </li>
  );
}
