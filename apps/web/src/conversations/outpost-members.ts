import type { ConversationSummary, MemberStory, Outpost } from '@spark-outpost/contracts';
import { placeMembers, showsFace, type MemberRole } from '../outposts/member-roles.ts';

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
  const listed = new Map<string, { chat: ConversationSummary; membership: Membership }[]>();
  for (const chat of chats) {
    const membership = isListedMember(chat, members) ? members.get(chat.id) : undefined;
    if (!membership) continue;
    const inOutpost = listed.get(membership.outpostId) ?? [];
    inOutpost.push({ chat, membership });
    listed.set(membership.outpostId, inOutpost);
  }
  const byOutpost = new Map<string, MemberChat[]>();
  for (const [outpostId, entries] of listed) byOutpost.set(outpostId, placed(entries));
  return byOutpost;
}

function placed(entries: { chat: ConversationSummary; membership: Membership }[]): MemberChat[] {
  const sorted = entries.toSorted((a, b) => a.membership.position - b.membership.position);
  const chatById = new Map(sorted.map(({ chat }) => [chat.id, chat]));
  const places = placeMembers(
    sorted.map(({ chat, membership }) => ({
      conversationId: chat.id,
      handle: membership.handle,
      ...(membership.story ? { story: membership.story } : {}),
    })),
  );
  const anyLead = places.some(({ role }) => role.kind === 'lead');
  return places.flatMap(({ member, role }) => {
    const chat = chatById.get(member.conversationId);
    return chat ? [{ chat, handle: member.handle, role, face: showsFace(role, anyLead) }] : [];
  });
}
