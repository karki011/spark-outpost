import type {
  BatchLine,
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

function batchOf(post: OutpostPost): string | null {
  return post.kind === 'request' ? post.batchId : null;
}

function batchItem(batchId: string, first: OutpostPost, posts: readonly OutpostPost[]): ThreadItem {
  const lines: BatchLine[] = posts
    .filter((post) => batchOf(post) === batchId)
    .map((post) => ({ post, handle: post.toHandle ?? 'chat' }));
  return { kind: 'batch', batchId, body: first.body, createdAt: first.createdAt, lines };
}

export const threadItems: ThreadItems = (posts) => {
  const ordered = inThreadOrder(posts);
  const drawn = new Set<string>();
  const items: ThreadItem[] = [];
  for (const post of ordered) {
    const batchId = batchOf(post);
    if (batchId === null) {
      items.push({ kind: post.kind, post });
      continue;
    }
    if (drawn.has(batchId)) continue;
    drawn.add(batchId);
    items.push(batchItem(batchId, post, ordered));
  }
  return items;
};

export const pinnedNotes: PinnedNotes = (posts) =>
  inThreadOrder(posts).filter((post) => post.kind === 'note' && post.pinnedAt !== null);

export const needsYouCount: NeedsYouCount = (posts) =>
  posts.filter((post) => post.kind === 'request' && post.state === 'needs_you').length;
