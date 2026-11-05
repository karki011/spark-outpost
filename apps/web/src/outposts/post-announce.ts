import type { OutpostPost, ThreadItem } from '@spark-outpost/contracts';
import { STATE_LABELS, receiverName, senderName } from './post-text.ts';

function postsOf(item: ThreadItem): OutpostPost[] {
  return item.kind === 'batch' ? item.lines.map((line) => line.post) : [item.post];
}

function stateLine(post: OutpostPost): string {
  const label = post.state ? STATE_LABELS[post.state] : '';
  return post.reason ? `${label}. ${post.reason}.` : `${label}.`;
}

function arrival(post: OutpostPost): string {
  if (post.kind === 'notice') return post.body;
  if (post.kind === 'note') return `${senderName(post)} posted a note.`;
  return `${senderName(post)} asked ${receiverName(post)}. ${stateLine(post)}`;
}

function change(before: OutpostPost, after: OutpostPost): string | null {
  if (after.kind !== 'request' || before.state === after.state) return null;
  return `Request to ${receiverName(after)}: ${stateLine(after)}`;
}

export function announcements(
  before: readonly ThreadItem[] | null,
  after: readonly ThreadItem[],
): string[] {
  if (before === null) return [];
  const known = new Map<string, OutpostPost>();
  for (const post of before.flatMap(postsOf)) known.set(post.id, post);
  const lines: string[] = [];
  for (const post of after.flatMap(postsOf)) {
    const earlier = known.get(post.id);
    const line = earlier ? change(earlier, post) : arrival(post);
    if (line) lines.push(line);
  }
  return lines;
}
