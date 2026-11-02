import { addressees, type OutpostMember, type PostAddress } from '@spark-outpost/contracts';
import type { NewPost, RequestAuthor } from './ports.ts';

export const NO_CHATS_TO_ASK = 'There is no chat in this outpost to ask yet.';
export const GUESTS_NOT_AVAILABLE =
  'Asking a chat outside the outpost is not available yet. Add the chat to the outpost first.';

export const CHATS_CANNOT_ASK_ALL = 'A chat cannot ask @all. Address one chat, for example @api.';
export const AUTHOR_NOT_MEMBER = 'This chat is not in that outpost.';
export const CANNOT_ASK_SELF = 'A chat cannot send a request to itself.';
export const OUTPOST_PAUSED = 'The outpost is paused. Requests wait until the user resumes it.';
export const REQUEST_STARTED_TURN =
  "This turn was started by another chat's request, so it cannot send requests. Answer in your reply.";

export const ASSISTANT_HANDLE = 'ask-spark';
export const ASSISTANT_ONE_CHAT =
  'Ask Spark addresses one chat per post, for example @api, or leaves a note.';

export function notMemberRefusal(handle: string): string {
  return `@${handle} is not in this outpost.`;
}

export function notAddressedRefusal(handle: string): string {
  return `The message does not address @${handle}.`;
}

export type PlanAddress = PostAddress | { kind: 'several'; to: readonly string[]; body: string };

export function keptProblem(
  kept: readonly string[],
  text: string,
  handles: readonly string[],
): string | null {
  const addressed = addressees(text, handles);
  for (const handle of kept) {
    if (!handles.includes(handle)) return notMemberRefusal(handle);
    if (!addressed.includes(handle)) return notAddressedRefusal(handle);
  }
  return null;
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

function userRequests(
  to: readonly string[],
  body: string,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
): PostPlan | Refusal {
  if (to.length === 0) return refusal(NO_CHATS_TO_ASK);
  const posts: PlannedPost[] = [];
  for (const handle of to) {
    const member = members.find((candidate) => candidate.handle === handle);
    if (!member) return refusal(notMemberRefusal(handle));
    posts.push({
      outpostId: outpost.id,
      kind: 'request',
      body,
      fromUser: true,
      toHandle: member.handle,
      toConversationId: member.conversationId,
    });
  }
  return { kind: 'plan', posts };
}

function userPost(
  address: PlanAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null,
): PostPlan | Refusal {
  if (guestConversationId !== null) return refusal(GUESTS_NOT_AVAILABLE);
  switch (address.kind) {
    case 'all':
      return userRequests(
        members.map((member) => member.handle),
        address.body,
        members,
        outpost,
      );
    case 'several':
      return userRequests(address.to, address.body, members, outpost);
    case 'request':
      return userRequests([address.to], address.body, members, outpost);
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
  address: PlanAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null,
): PostPlan | Refusal {
  if (guestConversationId !== null) return refusal(GUESTS_NOT_AVAILABLE);
  const sender = members.find((member) => member.conversationId === author.conversationId);
  if (!sender) return refusal(AUTHOR_NOT_MEMBER);
  switch (address.kind) {
    case 'all':
    case 'several':
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

type AssistantAuthor = Extract<RequestAuthor, { kind: 'assistant' }>;

function assistantPost(
  author: AssistantAuthor,
  address: PlanAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
): PostPlan | Refusal {
  const origin = {
    fromUser: false,
    fromConversationId: null,
    fromHandle: ASSISTANT_HANDLE,
    fromRunId: author.runId,
  };
  switch (address.kind) {
    case 'all':
    case 'several':
      return refusal(ASSISTANT_ONE_CHAT);
    case 'note':
      return {
        kind: 'plan',
        posts: [{ outpostId: outpost.id, kind: 'note', body: address.body, ...origin }],
      };
    case 'request': {
      if (outpost.paused) return refusal(OUTPOST_PAUSED);
      const member = members.find((candidate) => candidate.handle === address.to);
      if (!member) return refusal(notMemberRefusal(address.to));
      return {
        kind: 'plan',
        posts: [
          {
            outpostId: outpost.id,
            kind: 'request',
            body: address.body,
            ...origin,
            toHandle: member.handle,
            toConversationId: member.conversationId,
          },
        ],
      };
    }
  }
}

export function planPost(
  author: RequestAuthor,
  address: PlanAddress,
  members: readonly OutpostMember[],
  outpost: PlanOutpost,
  guestConversationId: string | null = null,
): PostPlan | Refusal {
  switch (author.kind) {
    case 'user':
      return userPost(address, members, outpost, guestConversationId);
    case 'chat':
      return chatPost(author, address, members, outpost, guestConversationId);
    case 'assistant':
      return guestConversationId === null
        ? assistantPost(author, address, members, outpost)
        : refusal(GUESTS_NOT_AVAILABLE);
  }
}
