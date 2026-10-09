import { requestState, type RequestFacts } from '@spark-outpost/contracts';
import type { StoredPost } from './ports.ts';

function isHeld(post: StoredPost): boolean {
  return (
    post.kind === 'request' &&
    post.afterPostId !== null &&
    post.taskId === null &&
    post.closedState === null
  );
}

export function released(post: StoredPost, afterFacts: RequestFacts | null): boolean {
  if (!isHeld(post) || afterFacts === null || afterFacts.paused) return false;
  return requestState(afterFacts).state === 'answered';
}
