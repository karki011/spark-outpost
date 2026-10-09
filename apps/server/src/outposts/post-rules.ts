import type { OutpostMember, PostAddress } from '@spark-outpost/contracts';
import type { NewPost, RequestAuthor } from './ports.ts';

export const ALL_NOT_AVAILABLE =
  '@all is not available yet. Address one chat at a time, for example @api.';
export const GUESTS_NOT_AVAILABLE =
  'Asking a chat outside the outpost is not available yet. Add the chat to the outpost first.';

export const CHATS_CANNOT_ASK_ALL = 'A chat cannot ask @all. Address one chat, for example @api.';
export const AUTHOR_NOT_MEMBER = 'This chat is not in that outpost.';
export const CANNOT_ASK_SELF = 'A chat cannot send a request to itself.';
export const OUTPOST_PAUSED = 'The outpost is paused. Requests wait until the user resumes it.';
export const REQUEST_STARTED_TURN =
  "This turn was started by another chat's request, so it cannot send requests. Answer in your reply.";

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

type ChatAuthor = Extract<RequestAuthor, { kind: 'chat' }>;

function chatOrigin(author: ChatAuthor, handle: string) {
  return {
    fromUser: false,
    fromConversationId: author.conversationId,
    fromHandle: handle,
    fromRunId: author.runId,
  };
}

function chatRequest(
  author: ChatAuthor,
  sender: OutpostMember,
  address: Extract<PostAddress, { kind: 'request' }>,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
): PostPlan | Refusal {
  if (author.startedByRequest) return refusal(REQUEST_STARTED_TURN);
  if (outpost.paused) return refusal(OUTPOST_PAUSED);
  const member = members.find((candidate) => candidate.handle === address.to);
  if (!member) return refusal(notMemberRefusal(address.to));
  if (member.conversationId === sender.conversationId) return refusal(CANNOT_ASK_SELF);
  return {
    kind: 'plan',
    posts: [
      {
        outpostId: outpost.id,
        kind: 'request',
        body: address.body,
        ...chatOrigin(author, sender.handle),
        toHandle: member.handle,
        toConversationId: member.conversationId,
      },
    ],
  };
}

function chatPost(
  author: ChatAuthor,
  address: PostAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null,
): PostPlan | Refusal {
  if (guestConversationId !== null) return refusal(GUESTS_NOT_AVAILABLE);
  const sender = members.find((member) => member.conversationId === author.conversationId);
  if (!sender) return refusal(AUTHOR_NOT_MEMBER);
  switch (address.kind) {
    case 'all':
      return author.startedByRequest
        ? refusal(REQUEST_STARTED_TURN)
        : refusal(CHATS_CANNOT_ASK_ALL);
    case 'request':
      return chatRequest(author, sender, address, members, outpost);
    case 'note':
      return {
        kind: 'plan',
        posts: [
          {
            outpostId: outpost.id,
            kind: 'note',
            body: address.body,
            ...chatOrigin(author, sender.handle),
          },
        ],
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
      return chatPost(author, address, members, outpost, guestConversationId);
  }
}
