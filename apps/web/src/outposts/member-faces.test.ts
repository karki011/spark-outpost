import { describe, expect, it } from 'vitest';
import { TEAMMATE_COLORS } from '@spark-outpost/contracts';
import { chatFaceStyle } from '../brand/chat-face.ts';
import { listedFaces, memberFaces, type JoinedMember } from './member-faces.ts';

function chatId(index: number): string {
  return `0c000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

const POOL = Array.from({ length: 600 }, (_, index) => chatId(index));

function chatsColored(color: string): string[] {
  return POOL.filter((id) => chatFaceStyle(id).color === color);
}

function joinedAt(order: number): string {
  return new Date(Date.UTC(2026, 9, 9, 10, 0, order)).toISOString();
}

function inJoinOrder(ids: readonly string[]): JoinedMember[] {
  return ids.map((conversationId, order) => ({ conversationId, joinedAt: joinedAt(order) }));
}

function styleKeys(faces: ReadonlyMap<string, { color: string; shape: string }>): string[] {
  return [...faces.values()].map((face) => `${face.color}/${face.shape}`);
}

const EMBER = chatsColored('ember');
const ONE_OF_EACH = TEAMMATE_COLORS.map((color) => chatsColored(color)[0]!);

describe('memberFaces', () => {
  it('leaves every member its own blob when no two share a colour', () => {
    const faces = memberFaces(inJoinOrder(ONE_OF_EACH));
    for (const id of ONE_OF_EACH) expect(faces.get(id)).toEqual(chatFaceStyle(id));
  });

  it('moves the later member of a clash to the first unused colour and keeps its shape', () => {
    const [first, second] = [EMBER[0]!, EMBER[1]!];
    const faces = memberFaces(inJoinOrder([first, second]));
    expect(faces.get(first)).toEqual(chatFaceStyle(first));
    expect(faces.get(second)).toEqual({ color: 'gold', shape: chatFaceStyle(second).shape });
  });

  it('orders by join time, then position, then id, whatever order the list arrives in', () => {
    const [first, second] = [EMBER[0]!, EMBER[1]!];
    const late = { conversationId: first, joinedAt: joinedAt(5) };
    const early = { conversationId: second, joinedAt: joinedAt(1) };
    expect(memberFaces([late, early]).get(second)?.color).toBe('ember');
    expect(memberFaces([late, early]).get(first)?.color).toBe('gold');
    const tied = [
      { conversationId: second, joinedAt: joinedAt(1), position: 2 },
      { conversationId: first, joinedAt: joinedAt(1), position: 1 },
    ];
    expect(memberFaces(tied).get(first)?.color).toBe('ember');
    const sameMoment = [second, first].map((conversationId) => ({
      conversationId,
      joinedAt: joinedAt(1),
    }));
    expect(memberFaces(sameMoment).get(first)?.color).toBe('ember');
  });

  it('gives eight members eight colours, then tells more members apart by shape', () => {
    const eight = memberFaces(inJoinOrder(EMBER.slice(0, 8)));
    expect(new Set([...eight.values()].map((face) => face.color)).size).toBe(8);
    const fifty = memberFaces(inJoinOrder(POOL.slice(0, 50)));
    expect(new Set(styleKeys(fifty)).size).toBe(50);
  });

  it('does not reshuffle members who joined before one that is removed', () => {
    const members = inJoinOrder(EMBER.slice(0, 6));
    const before = memberFaces(members);
    const after = memberFaces(members.filter((_, index) => index !== 3));
    for (const member of members.slice(0, 3)) {
      expect(after.get(member.conversationId)).toEqual(before.get(member.conversationId));
    }
    expect(after.has(members[3]!.conversationId)).toBe(false);
    expect(new Set(styleKeys(after)).size).toBe(5);
  });

  it('gives the same answer for the same members every time', () => {
    const members = inJoinOrder(POOL.slice(0, 20));
    expect([...memberFaces(members)]).toEqual([...memberFaces([...members].reverse())]);
  });
});

describe('listedFaces', () => {
  it('previews a list that has not joined yet in list order, as joining in that order gives', () => {
    const listed = EMBER.slice(0, 4);
    expect([...listedFaces([], listed)]).toEqual([...memberFaces(inJoinOrder(listed))]);
  });

  it('keeps joined members first, drops removed ones and appends added ones', () => {
    const joined = inJoinOrder(EMBER.slice(0, 3));
    const added = EMBER[3]!;
    const listed = [added, EMBER[2]!, EMBER[0]!];
    const faces = listedFaces(joined, listed);
    expect([...faces.keys()]).toEqual([EMBER[0]!, EMBER[2]!, added]);
    expect(faces.get(EMBER[0]!)).toEqual(chatFaceStyle(EMBER[0]!));
    expect(faces.get(EMBER[2]!)?.color).toBe('gold');
    expect(faces.get(added)?.color).toBe('moss');
  });
});
