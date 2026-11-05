import { describe, expect, it } from 'vitest';
import { memberRole, placeMembers, roleLine, showsFace, type StoryMember } from './member-roles.ts';

const LEAD = '00000000-0000-4000-8000-000000000001';
const API = '00000000-0000-4000-8000-000000000002';
const WEB = '00000000-0000-4000-8000-000000000003';
const DOCS = '00000000-0000-4000-8000-000000000004';
const OTHER_LEAD = '00000000-0000-4000-8000-000000000005';
const OTHER_SUB = '00000000-0000-4000-8000-000000000006';

function member(conversationId: string, handle: string, story?: StoryMember['story']) {
  return { conversationId, handle, ...(story ? { story } : {}) };
}

const story = [
  member(DOCS, 'docs'),
  member(WEB, 'web', { lead: LEAD, after: API, position: 1 }),
  member(LEAD, 'lead'),
  member(API, 'api', { lead: LEAD, after: null, position: 0 }),
];

describe('placeMembers', () => {
  it('lists the lead, then its sub-chats in story order, then chats added by hand', () => {
    expect(placeMembers(story).map(({ member }) => member.handle)).toEqual([
      'lead',
      'api',
      'web',
      'docs',
    ]);
  });

  it('follows each lead with its own sub-chats when an outpost has two stories', () => {
    const two = [
      ...story,
      member(OTHER_SUB, 'sub', { lead: OTHER_LEAD, after: null, position: 0 }),
      member(OTHER_LEAD, 'other'),
    ];
    expect(placeMembers(two).map(({ member }) => member.handle)).toEqual([
      'lead',
      'api',
      'web',
      'other',
      'sub',
      'docs',
    ]);
  });

  it('keeps join order and every face when no listed chat leads a story', () => {
    const orphaned = [
      member(DOCS, 'docs'),
      member(API, 'api', { lead: null, after: null, position: 0 }),
    ];
    const placed = placeMembers(orphaned);
    expect(placed.map(({ member }) => member.handle)).toEqual(['docs', 'api']);
    expect(placed.every(({ role }) => showsFace(role, false))).toBe(true);
  });
});

describe('roles', () => {
  it('gives only the lead a face once a story is listed', () => {
    const placed = placeMembers(story);
    expect(placed.map(({ role }) => showsFace(role, true))).toEqual([true, false, false, false]);
  });

  it('says who leads and what a sub-chat starts after', () => {
    const line = (id: string) => {
      const role = memberRole(story, id);
      return role ? roleLine(role) : 'not a member';
    };
    expect(line(LEAD)).toBe('Lead of 2 sub-chats');
    expect(line(WEB)).toBe('Sub-chat of @lead, starts after @api');
    expect(line(API)).toBe('Sub-chat of @lead');
    expect(line(DOCS)).toBeNull();
    expect(line(OTHER_LEAD)).toBe('not a member');
  });
});
