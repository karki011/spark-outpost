import type { OutpostMember } from '@spark-outpost/contracts';

export type MemberRole =
  | { kind: 'lead'; subChats: number }
  | { kind: 'sub'; leadHandle: string | null; afterHandle: string | null }
  | { kind: 'other' };

export type StoryMember = Pick<OutpostMember, 'conversationId' | 'handle' | 'story'>;

export interface PlacedMember<T extends StoryMember = StoryMember> {
  member: T;
  role: MemberRole;
}

function leadIds(members: readonly StoryMember[]): Set<string> {
  const listed = new Set(members.map((member) => member.conversationId));
  const leads = new Set<string>();
  for (const member of members) {
    const lead = member.story?.lead;
    if (lead && listed.has(lead)) leads.add(lead);
  }
  return leads;
}

function roleOf(
  member: StoryMember,
  leads: ReadonlySet<string>,
  members: readonly StoryMember[],
  handles: ReadonlyMap<string, string>,
): MemberRole {
  if (leads.has(member.conversationId)) {
    const subChats = members.filter((other) => other.story?.lead === member.conversationId).length;
    return { kind: 'lead', subChats };
  }
  if (!member.story) return { kind: 'other' };
  const { lead, after } = member.story;
  return {
    kind: 'sub',
    leadHandle: lead ? (handles.get(lead) ?? null) : null,
    afterHandle: after ? (handles.get(after) ?? null) : null,
  };
}

const byStoryPosition = (a: StoryMember, b: StoryMember) =>
  (a.story?.position ?? 0) - (b.story?.position ?? 0);

export function placeMembers<T extends StoryMember>(members: readonly T[]): PlacedMember<T>[] {
  const leads = leadIds(members);
  const handles = new Map(members.map((member) => [member.conversationId, member.handle]));
  const place = (member: T): PlacedMember<T> => ({
    member,
    role: roleOf(member, leads, members, handles),
  });
  if (leads.size === 0) return members.map(place);
  const placed: PlacedMember<T>[] = [];
  const seen = new Set<string>();
  const add = (member: T) => {
    if (seen.has(member.conversationId)) return;
    seen.add(member.conversationId);
    placed.push(place(member));
  };
  for (const lead of members.filter((member) => leads.has(member.conversationId))) {
    add(lead);
    members
      .filter((member) => member.story?.lead === lead.conversationId)
      .toSorted(byStoryPosition)
      .forEach(add);
  }
  members.filter((member) => member.story).forEach(add);
  members.forEach(add);
  return placed;
}

export function showsFace(role: MemberRole, anyLead: boolean): boolean {
  return !anyLead || role.kind === 'lead';
}

export function roleLine(role: MemberRole): string | null {
  if (role.kind === 'lead') {
    return role.subChats === 1 ? 'Lead of 1 sub-chat' : `Lead of ${role.subChats} sub-chats`;
  }
  if (role.kind !== 'sub') return null;
  const of = role.leadHandle ? `Sub-chat of @${role.leadHandle}` : 'Sub-chat';
  return role.afterHandle ? `${of}, starts after @${role.afterHandle}` : of;
}

export function memberRole(
  members: readonly StoryMember[],
  conversationId: string,
): MemberRole | null {
  return (
    placeMembers(members).find((placed) => placed.member.conversationId === conversationId)?.role ??
    null
  );
}
