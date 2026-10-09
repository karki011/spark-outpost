import type {
  NeedsYouCount,
  OutpostPost,
  PinnedNotes,
  ThreadItem,
  ThreadItems,
} from './outposts.ts';

function byCreatedAt(a: OutpostPost, b: OutpostPost): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

function inThreadOrder(posts: readonly OutpostPost[]): OutpostPost[] {
  return [...posts].sort(byCreatedAt);
}

function threadItem(post: OutpostPost): ThreadItem {
  return { kind: post.kind, post };
}

export const threadItems: ThreadItems = (posts) => inThreadOrder(posts).map(threadItem);

export const pinnedNotes: PinnedNotes = (posts) =>
  inThreadOrder(posts).filter((post) => post.kind === 'note' && post.pinnedAt !== null);

export const needsYouCount: NeedsYouCount = (posts) =>
  posts.filter((post) => post.kind === 'request' && post.state === 'needs_you').length;
