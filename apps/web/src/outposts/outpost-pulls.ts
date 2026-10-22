import type { ConversationSummary, OutpostPost, OutpostStory } from '@spark-outpost/contracts';
import { pullNumber, webLink } from './post-text.ts';
import { pullMark, type PullMark } from './story-bar.ts';

export interface OutpostPull {
  url: string;
  number: number | null;
  conversationId: string | null;
  handle: string;
  postId: string;
  state: PullMark;
}

function storyState(
  stories: readonly OutpostStory[],
  conversationId: string | null,
  number: number | null,
): PullMark | null {
  for (const story of stories) {
    for (const task of story.tasks) {
      const pull = task.pullRequest;
      if (!pull || task.conversationId !== conversationId || pull.number !== number) continue;
      return pullMark(pull);
    }
  }
  return null;
}

function chatMerged(chats: readonly ConversationSummary[], conversationId: string | null): boolean {
  return chats.some((chat) => chat.id === conversationId && chat.pullRequestMerged === true);
}

export function outpostPulls(
  posts: readonly OutpostPost[],
  stories: readonly OutpostStory[],
  chats: readonly ConversationSummary[],
): OutpostPull[] {
  const byUrl = new Map<string, OutpostPull>();
  for (const post of posts) {
    for (const url of post.answer?.pullRequests ?? []) {
      if (!webLink(url)) continue;
      const number = pullNumber(url);
      const conversationId = post.toConversationId;
      const state =
        storyState(stories, conversationId, number) ??
        (chatMerged(chats, conversationId) ? 'merged' : 'open');
      byUrl.set(url, {
        url,
        number,
        conversationId,
        handle: post.toHandle ?? 'chat',
        postId: post.id,
        state,
      });
    }
  }
  return [...byUrl.values()];
}

export function pullOf(post: OutpostPost, pulls: readonly OutpostPull[]): OutpostPull | null {
  const urls = post.answer?.pullRequests ?? [];
  const own = pulls.filter((pull) => urls.includes(pull.url));
  return own.at(-1) ?? null;
}

export function isOpenPull(pull: OutpostPull): boolean {
  return pull.state === 'open' || pull.state === 'draft';
}
