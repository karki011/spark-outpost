import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@spark-outpost/contracts';
import { inboxCards } from './inbox-state.ts';
import { approval, card, chat, CHAT_A, CHAT_B } from './inbox-test-fixtures.ts';

const AT = '2026-10-20T10:01:00.000Z';

function item(key: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key,
    kind: 'approval',
    blocking: true,
    conversationId: CHAT_A,
    detail: null,
    at: '2026-10-20T10:00:00.000Z',
    readAt: null,
    setAsideAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const asking = card('approval');
const askingKey = `approval:${asking.approval!.id}`;

describe('inboxCards', () => {
  it('keeps a read card waiting but marks it seen, so it no longer counts as new', () => {
    const sorted = inboxCards([asking], [item(askingKey, { readAt: AT })], true);
    expect(sorted.waiting).toEqual([asking]);
    expect(sorted.unread).toEqual([]);
    expect(sorted.seen.has(asking)).toBe(true);
  });

  it('counts an unread card as new once the items have loaded, never before', () => {
    expect(inboxCards([asking], [item(askingKey)], true).unread).toEqual([asking]);
    expect(inboxCards([asking], [], false).unread).toEqual([]);
  });

  it('moves a set-aside card to aside and drops a dismissed one', () => {
    const other = card('approval', {
      chat: chat(CHAT_B, { needsInput: true }),
      approval: approval({ id: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d' }),
    });
    const sorted = inboxCards(
      [asking, other],
      [
        item(askingKey, { setAsideAt: AT, readAt: AT }),
        item(`approval:${other.approval!.id}`, { conversationId: CHAT_B, dismissedAt: AT }),
      ],
      true,
    );
    expect(sorted.aside).toEqual([asking]);
    expect(sorted.waiting).toEqual([]);
  });

  it('drops a card the server no longer lists, so nothing stale stays', () => {
    expect(inboxCards([asking], [], true).waiting).toEqual([]);
  });

  it('matches a card without an approval to its chat’s blocking item', () => {
    const terminal = card('open');
    const key = `terminal:${CHAT_A}:1:5`;
    const sorted = inboxCards([terminal], [item(key, { kind: 'terminal', readAt: AT })], true);
    expect(sorted.seen.has(terminal)).toBe(true);
  });
});
