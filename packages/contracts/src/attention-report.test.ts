import { describe, expect, it } from 'vitest';
import { attentionReport } from './attention-report.ts';
import type { ConversationSummary } from './conversations.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: CHAT,
    title: 'Fix login',
    updatedAt: '2026-10-12T10:00:00.000Z',
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

describe('attentionReport', () => {
  it('carries the chat title beside the notification text', () => {
    const report = attentionReport([chat({ needsInput: true })]);
    expect(report.requests[0]).toMatchObject({
      chat: 'Fix login',
      title: 'Spark needs you: Fix login',
      body: 'Needs your input',
    });
  });

  it('counts a Terminal session that waits and says what it waits for', () => {
    const terminal = { state: 'waiting_for_permission' } as ConversationSummary['terminal'];
    const report = attentionReport([chat({ sessionType: 'terminal', terminal })]);
    expect(report.count).toBe(1);
    expect(report.requests[0]!.body).toBe('Waiting for permission');
  });
});
