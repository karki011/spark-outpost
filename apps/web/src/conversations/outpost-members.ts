import type { ConversationSummary, MemberStory, Outpost } from '@spark-outpost/contracts';
import {
  placeMembers,
  showsFace,
  type MemberRole,
  type StoryMember,
} from '../outposts/member-roles.ts';

export interface Membership {
  outpostId: string;
  handle: string;
  position: number;
  story?: MemberStory;
}

export interface MemberChat {
  chat: ConversationSummary;
  handle: string;
  role: MemberRole;
  face: boolean;
}

export type Memberships = ReadonlyMap<string, Membership>;
export type OutpostMembers = ReadonlyMap<string, readonly MemberChat[]>;

export const outpostFoldKey = (outpostId: string): string => `outpost:${outpostId}`;
export const outpostRowsId = (outpostId: string): string => `outpost:${outpostId}`;

export function memberships(outposts: readonly Outpost[]): Memberships {
  const byChat = new Map<string, Membership>();
  for (const outpost of outposts) {
    for (const member of outpost.members) {
      if (byChat.has(member.conversationId)) continue;
      byChat.set(member.conversationId, {
        outpostId: outpost.id,
        handle: member.handle,
        position: member.position,
        ...(member.story ? { story: member.story } : {}),
      });
    }
  }
  return byChat;
}

function isListedMember(chat: ConversationSummary, members: Memberships): boolean {
  return !chat.archivedAt && members.has(chat.id);
}

export function outsideOutposts(
  chats: readonly ConversationSummary[],
  members: Memberships,
): ConversationSummary[] {
  return chats.filter((chat) => !isListedMember(chat, members));
}

export function membersByOutpost(
  chats: readonly ConversationSummary[],
  members: Memberships,
): OutpostMembers {
  const listed = new Map<string, Map<string, ConversationSummary>>();
  for (const chat of chats) {
    const membership = isListedMember(chat, members) ? members.get(chat.id) : undefined;
    if (!membership) continue;
    const inOutpost = listed.get(membership.outpostId) ?? new Map<string, ConversationSummary>();
    inOutpost.set(chat.id, chat);
    listed.set(membership.outpostId, inOutpost);
  }
  const byOutpost = new Map<string, MemberChat[]>();
  for (const [outpostId, shown] of listed) {
    byOutpost.set(outpostId, placed(membersOf(outpostId, members), shown));
  }
  return byOutpost;
}

function membersOf(outpostId: string, members: Memberships): StoryMember[] {
  return [...members]
    .filter(([, membership]) => membership.outpostId === outpostId)
    .toSorted(([, a], [, b]) => a.position - b.position)
    .map(([conversationId, membership]) => ({
      conversationId,
      handle: membership.handle,
      ...(membership.story ? { story: membership.story } : {}),
    }));
}

function placed(
  all: readonly StoryMember[],
  shown: ReadonlyMap<string, ConversationSummary>,
): MemberChat[] {
  const places = placeMembers(all);
  const anyLead = places.some(({ role }) => role.kind === 'lead');
  return places.flatMap(({ member, role }) => {
    const chat = shown.get(member.conversationId);
    return chat ? [{ chat, handle: member.handle, role, face: showsFace(role, anyLead) }] : [];
  });
}
