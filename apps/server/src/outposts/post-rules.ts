import type { OutpostMember, PostAddress } from '@spark-outpost/contracts';
import type { NewPost, RequestAuthor } from './ports.ts';

export const ONLY_USER_POSTS = 'Only you can post in an outpost for now.';
export const ALL_NOT_AVAILABLE =
  '@all is not available yet. Address one chat at a time, for example @api.';
export const GUESTS_NOT_AVAILABLE =
  'Asking a chat outside the outpost is not available yet. Add the chat to the outpost first.';

export function notMemberRefusal(handle: string): string {
  return `@${handle} is not in this outpost.`;
}

export type PlannedPost = Omit<NewPost, 'id'>;

export interface PostPlan {
  kind: 'plan';
  posts: PlannedPost[];
}

export interface Refusal {
  kind: 'refusal';
  message: string;
}

export interface PlanOutpost {
  id: string;
  paused: boolean;
}

function refusal(message: string): Refusal {
  return { kind: 'refusal', message };
}

function userRequest(
  to: string,
  body: string,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
): PostPlan | Refusal {
  const member = members.find((candidate) => candidate.handle === to);
  if (!member) return refusal(notMemberRefusal(to));
  return {
    kind: 'plan',
    posts: [
      {
        outpostId: outpost.id,
        kind: 'request',
        body,
        fromUser: true,
        toHandle: member.handle,
        toConversationId: member.conversationId,
      },
    ],
  };
}

function userPost(
  address: PostAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null,
): PostPlan | Refusal {
  if (guestConversationId !== null) return refusal(GUESTS_NOT_AVAILABLE);
  switch (address.kind) {
    case 'all':
      return refusal(ALL_NOT_AVAILABLE);
    case 'request':
      return userRequest(address.to, address.body, members, outpost);
    case 'note':
      return {
        kind: 'plan',
        posts: [{ outpostId: outpost.id, kind: 'note', body: address.body, fromUser: true }],
      };
  }
}

export function planPost(
  author: RequestAuthor,
  address: PostAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null = null,
): PostPlan | Refusal {
  switch (author.kind) {
    case 'user':
      return userPost(address, members, outpost, guestConversationId);
    case 'chat':
      return refusal(ONLY_USER_POSTS);
  }
}
