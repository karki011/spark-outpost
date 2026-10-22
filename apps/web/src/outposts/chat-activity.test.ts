import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';
import { chatActivity } from './chat-activity.ts';
import { API_CHAT, FE_CHAT } from './test-fixtures.ts';

function chat(id: string, latestRun: object | null): ConversationSummary {
  return {
    id,
    title: 'Chat',
    updatedAt: '2026-10-09T10:00:00.000Z',
    projectIds: [],
    latestRun: latestRun as ConversationSummary['latestRun'],
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
  };
}

function chatId(number: number): string {
  return `0000000${number}-0000-4000-8000-000000000000`;
}

const run = (status: string, step: string | null = null) => ({ id: API_CHAT, status, step });

describe('chatActivity', () => {
  it('is the line the sidebar row shows for each chat that is working', () => {
    const chats = [
      chat(API_CHAT, run('running', 'Running the tests')),
      chat(FE_CHAT, run('queued')),
    ];
    const doing = chatActivity(chats);
    expect([...doing]).toEqual([
      [API_CHAT, 'Running the tests'],
      [FE_CHAT, 'Waiting to start'],
    ]);
    for (const each of chats) expect(doing.get(each.id)).toBe(rowState(each, false).sub);
  });

  it('falls back to Working when the turn has not named a step', () => {
    expect(chatActivity([chat(API_CHAT, run('running'))]).get(API_CHAT)).toBe('Working');
  });

  it('has nothing for a chat that is not working', () => {
    const chats = [
      chat(API_CHAT, run('failed')),
      chat(FE_CHAT, run('succeeded')),
      chat(chatId(3), null),
      { ...chat(chatId(4), run('running', 'Editing')), needsInput: true },
    ];
    expect(chatActivity(chats).size).toBe(0);
  });
});
