import { describe, expect, it } from 'vitest';
import type { SubChatRow, SubChatStatus } from '@spark-outpost/contracts';
import { canStartAnyway, placementFact, pullRequestFact, subChatGroups } from './sub-chats-pane.ts';

let next = 0;

function row(status: SubChatStatus, position: number, overrides: Partial<SubChatRow> = {}) {
  next += 1;
  const made: SubChatRow = {
    id: `77777777-7777-4777-8777-${String(next).padStart(12, '0')}`,
    title: `Piece ${position}`,
    position,
    status,
    why: null,
    task: 'Build it.',
    branch: null,
    pullRequest: null,
    startedWith: {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      agentMode: 'auto',
      level: 'full-auto',
    },
    stackedOn: null,
    startsAfter: [],
    startedAt: status === 'held' ? null : '2026-11-20T10:00:00.000Z',
    report: null,
    reportedAt: null,
    ...overrides,
  };
  return made;
}

const pull = (
  state: 'open' | 'merged' | 'closed',
  checks: 'passing' | 'failing' | 'pending' | 'none',
) => ({
  number: 412,
  url: 'https://github.com/acme/shop/pull/412',
  state,
  checks,
});

describe('the Sub-chats tab', () => {
  it('groups rows Needs you, Ready for review, Working, Held, Done, each in plan order', () => {
    const groups = subChatGroups([
      row('done', 5),
      row('working', 4),
      row('held', 3),
      row('working', 1),
      row('ready_for_review', 2),
      row('needs_you', 0),
    ]);
    expect(groups.map((group) => [group.label, group.rows.map((each) => each.position)])).toEqual([
      ['Needs you', [0]],
      ['Ready for review', [2]],
      ['Working', [1, 4]],
      ['Held', [3]],
      ['Done', [5]],
    ]);
  });

  it('keeps an empty group so the caller decides whether to show it', () => {
    const groups = subChatGroups([row('working', 0)]);
    expect(groups.filter((group) => group.rows.length === 0)).toHaveLength(4);
  });

  it('says where the pull request stands', () => {
    expect(pullRequestFact(null)).toBe('no pull request yet');
    expect(pullRequestFact(pull('open', 'passing'))).toBe('checks passing');
    expect(pullRequestFact(pull('open', 'failing'))).toBe('checks failing');
    expect(pullRequestFact(pull('open', 'pending'))).toBe('checks running');
    expect(pullRequestFact(pull('open', 'none'))).toBe('no checks');
    expect(pullRequestFact(pull('merged', 'passing'))).toBe('merged');
    expect(pullRequestFact(pull('closed', 'failing'))).toBe('closed');
  });

  it('says what a row is stacked on or starts after, by title', () => {
    const api = { id: '88888888-8888-4888-8888-888888888888', title: 'Payments API v2' };
    const cart = { id: '99999999-9999-4999-8999-999999999999', title: 'Cart totals' };
    expect(placementFact({ stackedOn: api, startsAfter: [api] })).toBe(
      'stacked on Payments API v2',
    );
    expect(placementFact({ stackedOn: null, startsAfter: [api, cart] })).toBe(
      'Starts after Payments API v2, Cart totals',
    );
    expect(placementFact({ stackedOn: null, startsAfter: [] })).toBeNull();
  });

  it('offers Start anyway only on a sub-chat that has not started', () => {
    expect(canStartAnyway(row('held', 0))).toBe(true);
    expect(canStartAnyway(row('working', 0))).toBe(false);
    expect(canStartAnyway(row('held', 0, { startedAt: '2026-11-20T10:00:00.000Z' }))).toBe(false);
  });
});
