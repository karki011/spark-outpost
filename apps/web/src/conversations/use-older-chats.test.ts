import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { mergeChatPages } from './use-older-chats.ts';

const chat = (id: string, title = id) => ({ id, title }) as ConversationSummary;

describe('mergeChatPages', () => {
  it('adds older pages after the newest chats and keeps the newest copy of a chat that moved up', () => {
    const merged = mergeChatPages(
      [chat('a', 'new'), chat('b')],
      [[chat('a', 'old'), chat('c')], [chat('d')]],
    );
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged[0]!.title).toBe('new');
  });
});
