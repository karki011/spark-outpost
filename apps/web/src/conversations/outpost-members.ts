import type { ConversationSummary, Outpost } from '@spark-outpost/contracts';

export interface Membership {
  outpostId: string;
  handle: string;
  position: number;
}

export interface MemberChat {
  chat: ConversationSummary;
  handle: string;
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
  const placed = chats.flatMap((chat) => {
    const membership = isListedMember(chat, members) ? members.get(chat.id) : undefined;
    return membership ? [{ chat, membership }] : [];
  });
  const byOutpost = new Map<string, MemberChat[]>();
  for (const { chat, membership } of placed.toSorted(
    (a, b) => a.membership.position - b.membership.position,
  )) {
    const listed = byOutpost.get(membership.outpostId) ?? [];
    listed.push({ chat, handle: membership.handle });
    byOutpost.set(membership.outpostId, listed);
  }
  return byOutpost;
}
