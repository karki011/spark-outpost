import { describe, expect, it } from 'vitest';
import {
  SEND_REFUSALS,
  sendRule,
  type SendFacts,
  type TargetChat,
  type TurnStart,
} from './asks.ts';

const SENDER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUB_CHAT = '33333333-3333-4333-8333-333333333333';
const SIBLING = '44444444-4444-4444-8444-444444444444';

const chat = (id: string, overrides: Partial<TargetChat> = {}): TargetChat => ({
  id,
  title: 'Billing export',
  terminal: false,
  assistant: false,
  hidden: false,
  archived: false,
  ownSubChat: false,
  ...overrides,
});

const facts = (overrides: Partial<SendFacts>): SendFacts => ({
  fromChatId: SENDER,
  to: chat(OTHER),
  startedBy: null,
  userAsked: false,
  ...overrides,
});

const startedBy = (overrides: Partial<TurnStart>): TurnStart => ({
  fromChatId: OTHER,
  kind: 'message',
  fromOwnSubChat: false,
  ...overrides,
});

describe('who may send a message to whom', () => {
  it('lets a parent message its own sub-chat by its mode', () => {
    const rule = sendRule(facts({ to: chat(SUB_CHAT, { ownSubChat: true }) }));
    expect(rule).toEqual({ kind: 'mode' });
  });

  it('lets a turn another chat’s message started answer that chat by its mode', () => {
    expect(sendRule(facts({ startedBy: startedBy({}) }))).toEqual({ kind: 'mode' });
  });

  it.each(['report', 'reply'] as const)(
    'lets a parent message any of its sub-chats in a turn a sub-chat’s %s started',
    (kind) => {
      const started = startedBy({ fromChatId: SUB_CHAT, kind, fromOwnSubChat: true });
      const toSibling = facts({ to: chat(SIBLING, { ownSubChat: true }), startedBy: started });
      expect(sendRule(toSibling)).toEqual({ kind: 'mode' });
      expect(sendRule(facts({ to: chat(OTHER), startedBy: started }))).toEqual({
        kind: 'refuse',
        reason: SEND_REFUSALS.parentChain,
      });
    },
  );

  it('refuses a chain: a turn another chat started cannot message a third chat', () => {
    const third = chat(SIBLING, { ownSubChat: true });
    expect(sendRule(facts({ to: third, startedBy: startedBy({}) }))).toEqual({
      kind: 'refuse',
      reason: SEND_REFUSALS.chain,
    });
    const userAsked = facts({ to: chat(SIBLING), startedBy: startedBy({}), userAsked: true });
    expect(sendRule(userAsked).kind).toBe('refuse');
  });

  it('gives a sub-chat’s plain message to its parent no right to message the siblings', () => {
    const started = startedBy({ fromChatId: SUB_CHAT, kind: 'message', fromOwnSubChat: true });
    const rule = sendRule(facts({ to: chat(SIBLING, { ownSubChat: true }), startedBy: started }));
    expect(rule).toEqual({ kind: 'refuse', reason: SEND_REFUSALS.chain });
  });

  it('refuses everything in a turn Spark’s own text started', () => {
    const started = startedBy({ fromChatId: null, kind: 'wrap_up' });
    const toSubChat = facts({ to: chat(SUB_CHAT, { ownSubChat: true }), startedBy: started });
    expect(sendRule(toSubChat).kind).toBe('refuse');
  });

  it('sends to any other chat only when the user asked for it by name, else a card', () => {
    expect(sendRule(facts({ userAsked: true }))).toEqual({ kind: 'asked' });
    expect(sendRule(facts({ userAsked: false }))).toEqual({ kind: 'card' });
  });

  it.each([
    ['a chat that is gone', null, SEND_REFUSALS.missing],
    ['itself', chat(SENDER), SEND_REFUSALS.self],
    ['a Terminal session', chat(OTHER, { terminal: true }), SEND_REFUSALS.terminal],
    ['Ask Spark’s chat', chat(OTHER, { assistant: true }), SEND_REFUSALS.assistant],
    ['a hidden crew chat', chat(OTHER, { hidden: true }), SEND_REFUSALS.hidden],
    ['an archived chat', chat(OTHER, { archived: true }), SEND_REFUSALS.archived],
  ])('refuses %s, even when the user asked or it is a sub-chat', (_name, to, reason) => {
    const asked = facts({ to: to && { ...to, ownSubChat: true }, userAsked: true });
    expect(sendRule(asked)).toEqual({ kind: 'refuse', reason });
  });
});
