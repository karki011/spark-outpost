import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { pickableChats, runInChatsLabel, startInChats } from './run-in-chats.ts';

const chat = (fields: Partial<ConversationSummary>) =>
  ({ archivedAt: null, updatedAt: '2026-11-20T10:00:00Z', ...fields }) as ConversationSummary;

describe('chats you can pick', () => {
  it('lists active chats newest first, matching the search, without Terminal sessions', () => {
    const chats = [
      chat({ id: 'old', title: 'Auth fix', updatedAt: '2026-11-19T10:00:00Z' }),
      chat({ id: 'new', title: 'Auth review' }),
      chat({ id: 'gone', title: 'Auth gone', archivedAt: '2026-11-18T10:00:00Z' }),
      chat({ id: 'term', title: 'Auth shell', sessionType: 'terminal' }),
      chat({ id: 'other', title: 'Docs' }),
    ];
    expect(pickableChats(chats, 'auth').map((entry) => entry.id)).toEqual(['new', 'old']);
  });
});

describe('starting in several chats', () => {
  it('starts every chat at once and reports each failure on its own', async () => {
    const started: string[] = [];
    const results = await startInChats('flow', ['a', 'b', 'c'], 'go', async (chatId) => {
      started.push(chatId);
      if (chatId === 'b') throw new Error('Chat not found.');
    });
    expect(started).toEqual(['a', 'b', 'c']);
    expect(results).toEqual([
      { chatId: 'a', ok: true },
      { chatId: 'b', ok: false, error: 'Chat not found.' },
      { chatId: 'c', ok: true },
    ]);
  });

  it('labels the button with the count', () => {
    expect(runInChatsLabel(0)).toBe('Run');
    expect(runInChatsLabel(1)).toBe('Run in 1 chat');
    expect(runInChatsLabel(3)).toBe('Run in 3 chats');
  });
});
