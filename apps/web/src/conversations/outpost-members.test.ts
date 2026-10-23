import { describe, expect, it } from 'vitest';
import type { ConversationSummary, Outpost } from '@spark-outpost/contracts';
import {
  membersByOutpost,
  memberships,
  outpostFoldKey,
  outsideOutposts,
} from './outpost-members.ts';

const ORDERS = 'orders';
const USAGE = 'usage';

function chat(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title: id,
    updatedAt: '2026-10-09T10:00:00Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...overrides,
  };
}

function outpost(id: string, members: [chatId: string, handle: string, position: number][]) {
  return {
    id,
    name: id,
    pausedAt: null,
    createdAt: '2026-10-09T10:00:00Z',
    updatedAt: '2026-10-09T10:00:00Z',
    needsYou: 0,
    instructions: '',
    members: members.map(([conversationId, handle, position]) => ({
      conversationId,
      handle,
      position,
      joinedAt: '2026-10-09T10:00:00Z',
    })),
  } satisfies Outpost;
}

const outposts = [
  outpost(ORDERS, [
    ['api', 'api', 1],
    ['fe', 'fe', 0],
  ]),
  outpost(USAGE, [['docs', 'docs', 0]]),
];

describe('memberships', () => {
  it('maps each member chat to its outpost and handle', () => {
    const members = memberships(outposts);
    expect(members.get('fe')).toEqual({ outpostId: ORDERS, handle: 'fe', position: 0 });
    expect(members.get('docs')).toEqual({ outpostId: USAGE, handle: 'docs', position: 0 });
    expect(members.has('loose')).toBe(false);
  });

  it('keeps a chat under the first outpost that lists it', () => {
    const twice = [...outposts, outpost('late', [['fe', 'web', 0]])];
    expect(memberships(twice).get('fe')?.outpostId).toBe(ORDERS);
  });
});

describe('outsideOutposts', () => {
  it('drops active member chats and keeps every other chat in order', () => {
    const chats = [chat('loose'), chat('fe'), chat('other'), chat('docs')];
    const rest = outsideOutposts(chats, memberships(outposts));
    expect(rest.map((item) => item.id)).toEqual(['loose', 'other']);
  });

  it('keeps an archived member so History still lists it', () => {
    const chats = [chat('fe', { archivedAt: '2026-10-09T11:00:00Z' })];
    expect(outsideOutposts(chats, memberships(outposts))).toHaveLength(1);
  });

  it('returns a chat to the rest once it has left its outpost', () => {
    const left = [outpost(ORDERS, [['api', 'api', 1]])];
    const rest = outsideOutposts([chat('fe'), chat('api')], memberships(left));
    expect(rest.map((item) => item.id)).toEqual(['fe']);
  });

  it('changes nothing when there are no outposts', () => {
    const chats = [chat('fe'), chat('api')];
    expect(outsideOutposts(chats, memberships([]))).toEqual(chats);
  });
});

describe('membersByOutpost', () => {
  it('lists the member chats of each outpost in member order with their handles', () => {
    const chats = [chat('api'), chat('docs'), chat('loose'), chat('fe')];
    const listed = membersByOutpost(chats, memberships(outposts));
    expect(listed.get(ORDERS)?.map((member) => [member.chat.id, member.handle])).toEqual([
      ['fe', 'fe'],
      ['api', 'api'],
    ]);
    expect(listed.get(USAGE)?.map((member) => member.chat.id)).toEqual(['docs']);
  });

  it('leaves out archived members and members the list does not hold', () => {
    const chats = [chat('fe', { archivedAt: '2026-10-09T11:00:00Z' })];
    const listed = membersByOutpost(chats, memberships(outposts));
    expect(listed.has(ORDERS)).toBe(false);
    expect(listed.has(USAGE)).toBe(false);
  });
});

describe('outpostFoldKey', () => {
  it('cannot collide with a project id or a section key', () => {
    expect(outpostFoldKey(ORDERS)).toBe('outpost:orders');
  });
});
