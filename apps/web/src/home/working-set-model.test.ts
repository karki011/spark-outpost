import { describe, expect, it } from 'vitest';
import type { AttentionItem, ConversationSummary } from '@spark-outpost/contracts';
import { reviewItems } from './working-set-model.ts';
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

describe('reviewItems', () => {
  const chats = [chat(1), chat(2), chat(3), chat(4, 'x')];

  it('lists clean pull requests first, then finished chats, once per chat', () => {
    const rows = reviewItems(
      [need(2, 'done'), need(3, 'done')],
      [clean(2), clean(1), clean(4)],
      chats,
    );
    expect(rows.map((row) => [row.chat.title, row.clean])).toEqual([
      ['Chat 2', true],
      ['Chat 1', true],
      ['Chat 3', false],
    ]);
    expect(rows[0]!.attentionKey).toBe(clean(2).key);
    expect(rows[2]!.attentionKey).toBeNull();
  });

  it('skips read pull requests and archived chats', () => {
    const rows = reviewItems(
      [],
      [clean(1, { readAt: '2026-11-10T09:00:00Z' }), clean(2), clean(4)],
      chats,
    );
    expect(rows.map((row) => row.chat.title)).toEqual(['Chat 2']);
  });
});
