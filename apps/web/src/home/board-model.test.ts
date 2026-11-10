import { describe, expect, it } from 'vitest';
import type { AttentionItem, ConversationSummary } from '@spark-outpost/contracts';
import { at, event } from '../calendar/test-fixtures.ts';
import { dayEvents, dayTitle, leftoverNeeds, needsColumn, reviewItems } from './board-model.ts';
import type { NeedItem, NeedTone } from './home-model.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chat = (n: number, archivedAt: string | null = null) =>
  ({ id: id(n), title: `Chat ${n}`, archivedAt }) as ConversationSummary;
const need = (n: number, tone: NeedTone): NeedItem => ({
  chat: chat(n),
  tone,
  sub: `sub ${n}`,
  action: 'Open',
  provider: null,
  expression: 'happy',
});
const clean = (n: number, overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  key: `pr-clean:${id(n)}:abcdef1`,
  kind: 'pr-clean',
  blocking: false,
  conversationId: id(n),
  detail: null,
  at: `2026-11-10T0${n}:00:00Z`,
  readAt: null,
  setAsideAt: null,
  dismissedAt: null,
  ...overrides,
});

describe('needs column', () => {
  const items = [need(1, 'asking'), need(2, 'error'), need(3, 'done')];

  it('keeps cards and errors the lead does not show, and leaves finished chats to review', () => {
    expect(leftoverNeeds(items, new Set()).map((item) => item.chat.title)).toEqual([
      'Chat 1',
      'Chat 2',
    ]);
    expect(leftoverNeeds(items, new Set([id(1)])).map((item) => item.chat.title)).toEqual([
      'Chat 2',
    ]);
  });

  it('is Needs you with leftovers and Pick up next without', () => {
    expect(needsColumn(leftoverNeeds(items, new Set()))).toBe('needs');
    expect(needsColumn(leftoverNeeds(items, new Set([id(1), id(2)])))).toBe('pickup');
    expect(needsColumn([])).toBe('pickup');
  });
});

describe('reviewItems', () => {
  const chats = [chat(1), chat(2), chat(3), chat(4, 'x')];

  it('lists clean pull requests first, then finished chats, once per chat', () => {
    const rows = reviewItems(
      [need(2, 'done'), need(3, 'done')],
      [clean(2), clean(1), clean(4)],
      chats,
      new Set(),
    );
    expect(rows.map((row) => [row.chat.title, row.clean])).toEqual([
      ['Chat 2', true],
      ['Chat 1', true],
      ['Chat 3', false],
    ]);
    expect(rows[0]!.attentionKey).toBe(clean(2).key);
    expect(rows[2]!.attentionKey).toBeNull();
  });

  it('skips read pull requests and chats the lead already shows', () => {
    const rows = reviewItems(
      [need(3, 'done')],
      [clean(1, { readAt: '2026-11-10T09:00:00Z' }), clean(2)],
      chats,
      new Set([id(3)]),
    );
    expect(rows.map((row) => row.chat.title)).toEqual(['Chat 2']);
  });
});

describe('dayTitle', () => {
  it('names the calendar column for the state', () => {
    expect(dayTitle('meeting')).toBe('After the meeting');
    expect(dayTitle('before-you-go')).toBe('Your day');
    expect(dayTitle('board')).toBe('Your day');
    expect(dayTitle('since-you-left')).toBe('Your day');
  });
});

describe('dayEvents', () => {
  const standup = event('Standup', at(9, 30), at(9, 45));
  const sync = event('Design sync', at(14, 50), at(15, 20));

  it('lists the meetings left today', () => {
    expect(dayEvents([standup, sync], null).map((entry) => entry.title)).toEqual([
      'Standup',
      'Design sync',
    ]);
  });

  it('leaves out the meeting the lead already shows', () => {
    expect(dayEvents([standup, sync], sync.key).map((entry) => entry.title)).toEqual(['Standup']);
  });
});
